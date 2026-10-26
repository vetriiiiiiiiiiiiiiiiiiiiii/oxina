import type { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { calculateEta, type EtaTask, type PartsState, type Range } from "@/lib/eta/calculate";
import { formatInTimeZone } from "date-fns-tz";
import { getBranchSetting, getDuration } from "../settings";

const FALLBACK: Record<string, Range> = {
  BASIC_INSPECTION: { min: 20, max: 30 },
  ESTIMATE_PREPARATION: { min: 10, max: 15 },
  QUALITY_INSPECTION: { min: 15, max: 30 },
  TEST_RIDE: { min: 10, max: 20 },
  FINAL_BILLING: { min: 10, max: 20 },
};

async function std(tx: Tx, job: { branchId: string; businessUnitId: string; vehicleModelId: string | null }, key: string): Promise<Range> {
  const d = await getDuration(tx, { businessUnitId: job.businessUnitId, branchId: job.branchId, vehicleModelId: job.vehicleModelId, taskKey: key });
  return d ? { min: d.minMinutes, max: d.maxMinutes } : FALLBACK[key];
}

/**
 * Recalculate and persist a job's ETA. Called after any event that affects it
 * (task progress, parts status, approval, QC result). Returns whether the
 * latest completion moved by more than 30 minutes (callers may notify the customer).
 */
export async function recalcEta(tx: Tx, jobId: string, now = new Date()) {
  const job = await tx.serviceJob.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      branch: { include: { holidays: true } },
      customerVehicle: true,
      tasks: { include: { dependencies: true, partRequests: true } },
      qualityInspections: { orderBy: { startedAt: "desc" }, take: 1 },
    },
  });
  if (["READY_FOR_DELIVERY", "DELIVERED", "CLOSED", "CANCELLED"].includes(job.status)) return { changed: false };

  const unit = { branchId: job.branchId, businessUnitId: job.branch.businessUnitId, vehicleModelId: job.customerVehicle.vehicleModelId };
  const calendar = {
    timezone: job.branch.timezone,
    workdayStart: job.branch.workdayStart,
    workdayEnd: job.branch.workdayEnd,
    workingDays: job.branch.workingDays,
    holidays: job.branch.holidays.map((h) => h.date.toISOString().slice(0, 10)),
  };

  const tasks: EtaTask[] = job.tasks.map((t) => {
    const open = t.partRequests.filter((r) => r.status !== "ISSUED" && r.status !== "CANCELLED");
    let parts: PartsState = { kind: "READY" };
    for (const r of open) {
      if (r.status === "UNAVAILABLE" || r.status === "AWAITING_PROCUREMENT") {
        if (!r.expectedAvailableAt) {
          parts = { kind: "UNKNOWN" };
          break;
        }
        if (parts.kind !== "EXPECTED" || r.expectedAvailableAt > parts.at) parts = { kind: "EXPECTED", at: r.expectedAvailableAt };
      }
    }
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      minMinutes: t.estimatedMinMinutes,
      maxMinutes: t.estimatedMaxMinutes,
      workedMinutes: t.workedMinutes,
      runningSince: t.status === "IN_PROGRESS" ? t.lastResumedAt : null,
      dependsOn: t.dependencies.map((d) => d.dependsOnTaskId),
      mechanicId: t.assignedMechanicId,
      awaitingApproval: t.requiresApproval && !t.approved && t.status !== "CANCELLED",
      parts,
    };
  });

  // Existing workload of the mechanics on this job (other open jobs' remaining tasks).
  const mechanicIds = [...new Set(job.tasks.map((t) => t.assignedMechanicId).filter((x): x is string => !!x))];
  const mechanicBacklog: Record<string, Range> = {};
  if (mechanicIds.length) {
    const other = await tx.repairTask.findMany({
      where: { assignedMechanicId: { in: mechanicIds }, jobId: { not: jobId }, status: { in: ["READY", "IN_PROGRESS", "PAUSED"] } },
      select: { assignedMechanicId: true, estimatedMinMinutes: true, estimatedMaxMinutes: true, workedMinutes: true, status: true },
    });
    for (const o of other) {
      const m = (mechanicBacklog[o.assignedMechanicId!] ??= { min: 0, max: 0 });
      // Only work that is queued ahead of us; in-progress work counts its remainder.
      m.min += Math.max(0, o.estimatedMinMinutes - o.workedMinutes);
      m.max += Math.max(0, o.estimatedMaxMinutes - o.workedMinutes);
    }
  }

  const activeMechanics = await tx.serviceJobAssignment.count({ where: { jobId, role: "MECHANIC", releasedAt: null } });
  const qc = await std(tx, unit, "QUALITY_INSPECTION");
  const ride = await std(tx, unit, "TEST_RIDE");
  const bill = await std(tx, unit, "FINAL_BILLING");
  const qcDone = job.status === "FINAL_BILLING";
  const postRepair: Range = qcDone ? bill : { min: qc.min + ride.min + bill.min, max: qc.max + ride.max + bill.max };

  let preRepair: Range | undefined;
  if (job.status === "RECEIVED" || job.status === "INSPECTION") {
    if (!job.tasks.length) {
      // Before diagnosis the remaining repair work is unknown; no ETA is promised.
      await tx.serviceJob.update({
        where: { id: jobId },
        data: { etaEarliest: null, etaLatest: null, etaConfidence: "UNKNOWN", etaUpdatedAt: now, etaBreakdown: { reason: "Available after inspection." } },
      });
      return { changed: false };
    }
    const insp = await std(tx, unit, "ESTIMATE_PREPARATION");
    preRepair = insp;
  }

  const approvalWait = (await getBranchSetting(tx, job.branchId, "service.approvalWaitMinutes")) as Range;
  const result = calculateEta({
    now,
    receivedAt: job.receivedAt,
    calendar,
    tasks,
    mechanicBacklog,
    poolLanes: Math.max(1, activeMechanics || 1),
    approvalWait: tasks.some((t) => t.awaitingApproval && t.status !== "CANCELLED") ? approvalWait : { min: 0, max: 0 },
    postRepair,
    preRepair,
  });

  const prevLatest = job.etaLatest;
  await tx.serviceJob.update({
    where: { id: jobId },
    data: {
      etaEarliest: result.earliest,
      etaLatest: result.latest,
      etaConfidence: result.confidence,
      etaUpdatedAt: now,
      etaBreakdown: { ...result.breakdown, reason: result.reason } as unknown as Prisma.InputJsonValue,
    },
  });
  const changed =
    (prevLatest?.getTime() ?? null) !== (result.latest?.getTime() ?? null) &&
    (!prevLatest || !result.latest || Math.abs(prevLatest.getTime() - result.latest.getTime()) > 30 * 60_000);
  return { changed, result, formatted: result.latest ? formatInTimeZone(result.latest, job.branch.timezone, "d MMM, h:mm a") : null };
}
