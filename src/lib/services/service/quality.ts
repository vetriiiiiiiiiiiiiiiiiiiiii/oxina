import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { invalid, notFound, rule } from "@/lib/errors";
import { requirePermission, type Actor } from "@/lib/rbac/actor";
import { audit } from "@/lib/audit";
import { notifyUsers } from "@/lib/notifications";
import { activity, afterCommit, getJobForActor, lockJob, setJobStatus, timeline } from "./common";
import { recalcEta } from "./eta";

export interface QcItem {
  key: string;
  label: string;
  mandatory: boolean;
  safetyCritical: boolean;
  result?: "PASS" | "FAIL" | "NA";
  notes?: string;
}

export const DEFAULT_QC_CHECKLIST: QcItem[] = [
  { key: "front_brake", label: "Front brake operation and pad wear", mandatory: true, safetyCritical: true },
  { key: "rear_brake", label: "Rear brake operation", mandatory: true, safetyCritical: true },
  { key: "lights", label: "Headlamp, tail lamp, indicators, horn", mandatory: true, safetyCritical: true },
  { key: "tyres", label: "Tyre pressure and condition", mandatory: true, safetyCritical: true },
  { key: "chain", label: "Chain tension and lubrication", mandatory: true, safetyCritical: false },
  { key: "fluids", label: "Engine oil level, no leaks", mandatory: true, safetyCritical: false },
  { key: "fasteners", label: "Critical fasteners torqued", mandatory: true, safetyCritical: true },
  { key: "repairs", label: "All approved repairs verified", mandatory: true, safetyCritical: false },
  { key: "cleanliness", label: "Vehicle cleaned, no tools left", mandatory: false, safetyCritical: false },
];

async function checklistFor(tx: Tx, businessUnitId: string): Promise<QcItem[]> {
  const t = await tx.inspectionChecklistTemplate.findFirst({ where: { businessUnitId, kind: "QUALITY", isActive: true } });
  return (t?.items as unknown as QcItem[]) ?? DEFAULT_QC_CHECKLIST;
}

export async function startQualityInspection(actor: Actor, jobId: string) {
  requirePermission(actor, "service.quality.inspect");
  const job = await getJobForActor(actor, jobId);
  return prisma.$transaction(async (tx) => {
    const j = await lockJob(tx, jobId);
    if (j.status !== "QUALITY_CHECK") throw rule("Quality inspection starts after all repair tasks are complete.");
    const open = await tx.qualityInspection.findFirst({ where: { jobId, result: "PENDING" } });
    if (open) return open;
    const qc = await tx.qualityInspection.create({
      data: { jobId, inspectorId: actor.userId, checklist: (await checklistFor(tx, job.branch.businessUnitId)) as unknown as Prisma.InputJsonValue },
    });
    await tx.serviceJobAssignment.create({ data: { jobId, userId: actor.userId, role: "INSPECTOR", assignedById: actor.userId } });
    await timeline(tx, jobId, { stage: "QUALITY_INSPECTION", state: "ACTIVE", title: "Quality inspection started", actor });
    await activity(tx, job.branchId, jobId, actor.userId, "qc.started", { qcId: qc.id });
    return qc;
  }).finally(() => afterCommit(jobId));
}

export const testRideStartInput = z.object({ odometerStart: z.coerce.number().int().min(0) });
export const testRideEndInput = z.object({
  odometerEnd: z.coerce.number().int().min(0),
  observations: z.string().trim().max(2000).optional(),
  result: z.enum(["OK", "ISSUES_FOUND"]),
});

export async function startTestRide(actor: Actor, qcId: string, input: z.infer<typeof testRideStartInput>) {
  requirePermission(actor, "service.quality.inspect");
  const qc = await prisma.qualityInspection.findUnique({ where: { id: qcId } });
  if (!qc) throw notFound("Quality inspection");
  const job = await getJobForActor(actor, qc.jobId);
  if (qc.result !== "PENDING") throw rule("This inspection is already complete.");
  if (input.odometerStart < job.odometerIn) throw invalid(`Odometer cannot be below the intake reading (${job.odometerIn} km).`);
  const running = await prisma.testRide.findFirst({ where: { qualityInspectionId: qcId, endedAt: null } });
  if (running) throw rule("A test ride is already in progress.");
  await prisma.$transaction(async (tx) => {
    await tx.testRide.create({ data: { jobId: qc.jobId, qualityInspectionId: qcId, riderId: actor.userId, startedAt: new Date(), odometerStart: input.odometerStart } });
    await timeline(tx, qc.jobId, { stage: "TEST_RIDE", state: "ACTIVE", title: "Test ride in progress", actor });
  });
  afterCommit(qc.jobId);
}

export async function endTestRide(actor: Actor, rideId: string, input: z.infer<typeof testRideEndInput>) {
  requirePermission(actor, "service.quality.inspect");
  const ride = await prisma.testRide.findUnique({ where: { id: rideId } });
  if (!ride) throw notFound("Test ride");
  await getJobForActor(actor, ride.jobId);
  if (ride.endedAt) throw rule("This test ride has already ended.");
  if (input.odometerEnd < ride.odometerStart) throw invalid("End odometer must be at least the start reading.");
  await prisma.$transaction(async (tx) => {
    await tx.testRide.update({ where: { id: rideId }, data: { endedAt: new Date(), odometerEnd: input.odometerEnd, observations: input.observations, result: input.result } });
    await timeline(tx, ride.jobId, {
      stage: "TEST_RIDE",
      state: input.result === "OK" ? "COMPLETED" : "FAILED",
      title: input.result === "OK" ? "Test ride completed" : "Test ride found items that need attention",
      actor,
    });
  });
  afterCommit(ride.jobId);
}

export const qcCompleteInput = z.object({
  checklist: z.array(z.object({ key: z.string(), result: z.enum(["PASS", "FAIL", "NA"]), notes: z.string().max(500).optional() })),
  testRideRequired: z.boolean(),
  result: z.enum(["PASSED", "FAILED"]),
  failureReason: z.string().trim().max(1000).optional(),
  returnTaskIds: z.array(z.string().uuid()).default([]),
  notes: z.string().trim().max(2000).optional(),
});

export async function completeQualityInspection(actor: Actor, qcId: string, input: z.infer<typeof qcCompleteInput>) {
  requirePermission(actor, "service.quality.inspect");
  const qc = await prisma.qualityInspection.findUnique({ where: { id: qcId } });
  if (!qc) throw notFound("Quality inspection");
  const job = await getJobForActor(actor, qc.jobId);
  await prisma.$transaction(async (tx) => {
    const j = await lockJob(tx, job.id);
    const current = await tx.qualityInspection.findUniqueOrThrow({ where: { id: qcId }, include: { testRides: true } });
    if (current.result !== "PENDING") throw rule("This inspection is already complete.");
    const template = current.checklist as unknown as QcItem[];
    const given = new Map(input.checklist.map((c) => [c.key, c]));
    const merged = template.map((t) => ({ ...t, result: given.get(t.key)?.result, notes: given.get(t.key)?.notes }));

    if (input.result === "PASSED") {
      const missing = merged.filter((m) => m.mandatory && m.result !== "PASS");
      if (missing.length) throw rule(`Mandatory checks not passed: ${missing.map((m) => m.label).join("; ")}.`);
      if (input.testRideRequired) {
        const ok = current.testRides.some((r) => r.endedAt && r.result === "OK");
        if (!ok) throw rule("A completed test ride with an OK result is required before passing.");
      }
    } else {
      if (!input.failureReason || input.failureReason.length < 5) throw invalid("Record why the inspection failed.");
      if (!input.returnTaskIds.length) throw invalid("Select the repair task(s) to return the vehicle to.");
    }

    await tx.qualityInspection.update({
      where: { id: qcId },
      data: {
        checklist: merged as unknown as Prisma.InputJsonValue,
        testRideRequired: input.testRideRequired,
        result: input.result,
        failureReason: input.failureReason ?? null,
        returnedTaskIds: input.returnTaskIds,
        notes: input.notes ?? null,
        completedAt: new Date(),
      },
    });

    if (input.result === "PASSED") {
      await setJobStatus(tx, j, "FINAL_BILLING");
      await timeline(tx, job.id, { stage: "QUALITY_INSPECTION", state: "COMPLETED", title: "Quality inspection passed", actor, nextExpectedAction: "Final invoice is being prepared." });
      await timeline(tx, job.id, { stage: "FINAL_BILLING", state: "ACTIVE", title: "Final invoice being prepared" });
      const { branchUsersWithRoles } = await import("@/lib/notifications");
      const billing = await branchUsersWithRoles(tx, job.branchId, ["BILLING_EXECUTIVE"]);
      await notifyUsers(tx, [...billing, j.serviceAdvisorId], { type: "QC_PASSED", title: `QC passed — ${j.jobNumber}`, body: "Prepare the final invoice.", link: `/service/${job.id}`, branchId: job.branchId });
    } else {
      const tasks = await tx.repairTask.findMany({ where: { id: { in: input.returnTaskIds }, jobId: job.id, status: "COMPLETED" } });
      if (tasks.length !== input.returnTaskIds.length) throw invalid("Only completed tasks of this job can be returned for rework.");
      for (const t of tasks) {
        await tx.repairTask.update({
          where: { id: t.id },
          data: { status: "READY", completedAt: null, reworkCount: { increment: 1 }, holdReason: `QC rework: ${input.failureReason}`, version: { increment: 1 } },
        });
        await tx.mechanicWorkLog.create({ data: { taskId: t.id, mechanicId: actor.userId, fromStatus: "COMPLETED", toStatus: "READY", reason: `QC failed: ${input.failureReason}` } });
        if (t.assignedMechanicId) await notifyUsers(tx, [t.assignedMechanicId], { type: "QC_FAILED", title: `Rework needed: ${t.title}`, body: input.failureReason!, link: "/service/board", branchId: job.branchId });
      }
      await setJobStatus(tx, j, "IN_REPAIR");
      await timeline(tx, job.id, {
        stage: "QUALITY_INSPECTION",
        state: "FAILED",
        title: "Quality inspection found items that need further work",
        customerNote: "Our technicians are addressing the items found during the quality check before your vehicle is released.",
        actor,
      });
      await notifyUsers(tx, [j.serviceAdvisorId], { type: "QC_FAILED", title: `QC failed — ${j.jobNumber}`, body: input.failureReason!, link: `/service/${job.id}`, branchId: job.branchId });
    }
    await activity(tx, job.branchId, job.id, actor.userId, `qc.${input.result.toLowerCase()}`, { qcId, reason: input.failureReason ?? null });
    await audit(tx, { actorId: actor.userId, action: `service.qc.${input.result.toLowerCase()}`, entityType: "QualityInspection", entityId: qcId, branchId: job.branchId });
    await recalcEta(tx, job.id);
  });
  afterCommit(job.id);
}

/** Mandatory QC has passed and no repair work has happened since. */
export async function qualityGatePassed(tx: Tx, jobId: string) {
  const anyWork = await tx.repairTask.count({ where: { jobId, status: "COMPLETED" } });
  if (!anyWork) return true; // nothing repaired (e.g. estimate declined): no QC needed
  const last = await tx.qualityInspection.findFirst({ where: { jobId }, orderBy: { startedAt: "desc" } });
  if (!last || last.result !== "PASSED" || !last.completedAt) return false;
  const reworkAfter = await tx.mechanicWorkLog.count({ where: { task: { jobId }, toStatus: "COMPLETED", createdAt: { gt: last.completedAt } } });
  return reworkAfter === 0;
}
