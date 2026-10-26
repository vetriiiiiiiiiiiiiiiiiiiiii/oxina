import { z } from "zod";
import type { RepairTaskStatus } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { conflict, forbidden, invalid, notFound, rule } from "@/lib/errors";
import { branchFilter, can, requirePermission, type Actor } from "@/lib/rbac/actor";
import { notifyUsers } from "@/lib/notifications";
import { activity, afterCommit, getJobForActor, lockJob, setJobStatus, timeline } from "./common";
import { recalcEta } from "./eta";

const WORKABLE_JOB = ["APPROVED", "PARTS_PENDING", "IN_REPAIR", "AWAITING_APPROVAL", "QUALITY_CHECK"];

/** Why a task cannot start right now (null = it can). */
export function startBlocker(
  task: { requiresApproval: boolean; approved: boolean; isSafetyCritical: boolean; status: RepairTaskStatus },
  job: { isEmergency: boolean; status: string },
  depsDone: boolean,
  partsIssued: boolean,
): string | null {
  if (!WORKABLE_JOB.includes(job.status)) return "The job is not in a repair stage.";
  if (task.requiresApproval && !task.approved && !(job.isEmergency && task.isSafetyCritical)) return "Awaiting customer approval for this chargeable work.";
  if (!depsDone) return "Waiting for a preceding task to finish.";
  if (!partsIssued) return "Waiting for spare parts to be issued.";
  return null;
}

/**
 * Recompute READY/BLOCKED for not-yet-started tasks from approvals, dependencies and parts.
 * Tasks a mechanic manually blocked keep their reason until explicitly unblocked.
 */
export async function refreshTaskReadiness(tx: Tx, jobId: string, actorId: string | null) {
  const job = await tx.serviceJob.findUniqueOrThrow({ where: { id: jobId } });
  const tasks = await tx.repairTask.findMany({ where: { jobId }, include: { dependencies: true, partRequests: true } });
  const status = new Map(tasks.map((t) => [t.id, t.status]));
  for (const t of tasks) {
    if (!["PENDING", "READY", "BLOCKED"].includes(t.status)) continue;
    const depsDone = t.dependencies.every((d) => status.get(d.dependsOnTaskId) === "COMPLETED" || status.get(d.dependsOnTaskId) === "CANCELLED");
    const missingParts = t.partRequests.filter((r) => r.status === "UNAVAILABLE" || r.status === "AWAITING_PROCUREMENT");
    const partsIssued = t.partRequests.every((r) => r.status === "ISSUED" || r.status === "CANCELLED");
    const approvedOk = !t.requiresApproval || t.approved || (job.isEmergency && t.isSafetyCritical);
    let next: RepairTaskStatus = t.status;
    let reason: string | null = t.holdReason;
    if (t.status === "BLOCKED" && t.holdReason && !t.holdReason.startsWith("Awaiting spare part")) continue; // manual block
    if (approvedOk && missingParts.length) {
      next = "BLOCKED";
      reason = `Awaiting spare part: ${missingParts.length} item(s) unavailable`;
    } else if (approvedOk && depsDone && partsIssued) {
      next = "READY";
      reason = null;
    } else {
      next = "PENDING";
      reason = null;
    }
    if (next !== t.status) {
      await tx.repairTask.update({ where: { id: t.id }, data: { status: next, holdReason: reason, version: { increment: 1 } } });
      await tx.mechanicWorkLog.create({
        data: { taskId: t.id, mechanicId: t.assignedMechanicId ?? actorId ?? job.serviceAdvisorId, fromStatus: t.status, toStatus: next, reason: reason ?? "Prerequisites met" },
      });
      status.set(t.id, next);
    }
  }
}

export const assignMechanicInput = z.object({ mechanicId: z.string().uuid().nullable() });

export async function assignTaskMechanic(actor: Actor, taskId: string, input: z.infer<typeof assignMechanicInput>) {
  requirePermission(actor, "service.repair.assign");
  const task = await prisma.repairTask.findUnique({ where: { id: taskId } });
  if (!task) throw notFound("Task");
  const job = await getJobForActor(actor, task.jobId);
  if (task.status === "IN_PROGRESS") throw rule("Pause the task before reassigning it.");
  await prisma.$transaction(async (tx) => {
    if (input.mechanicId) {
      const m = await tx.user.findFirst({
        where: { id: input.mechanicId, isActive: true, branchAssignments: { some: { branchId: job.branchId } }, roles: { some: { role: { key: "MECHANIC" } } } },
      });
      if (!m) throw invalid("Select a mechanic assigned to this branch.");
      const has = await tx.serviceJobAssignment.findFirst({ where: { jobId: job.id, userId: m.id, role: "MECHANIC", releasedAt: null } });
      if (!has) await tx.serviceJobAssignment.create({ data: { jobId: job.id, userId: m.id, role: "MECHANIC", assignedById: actor.userId } });
      await notifyUsers(tx, [m.id], { type: "TASK_ASSIGNED", title: `New task: ${task.title}`, body: `Job ${job.jobNumber}`, link: `/service/board`, branchId: job.branchId });
    }
    await tx.repairTask.update({ where: { id: taskId }, data: { assignedMechanicId: input.mechanicId, version: { increment: 1 } } });
    await tx.sparePartRequest.updateMany({ where: { repairTaskId: taskId, status: { not: "ISSUED" } }, data: { assignedMechanicId: input.mechanicId } });
    await activity(tx, job.branchId, job.id, actor.userId, "task.assigned", { taskId, mechanicId: input.mechanicId });
    await recalcEta(tx, job.id);
  });
  afterCommit(job.id);
}

export const transitionInput = z.object({
  action: z.enum(["START", "PAUSE", "RESUME", "BLOCK", "UNBLOCK", "COMPLETE"]),
  reason: z.string().trim().max(500).optional(),
  expectedVersion: z.number().int().optional(),
});

const NEEDS_REASON = new Set(["PAUSE", "BLOCK"]);

export async function transitionTask(actor: Actor, taskId: string, input: z.infer<typeof transitionInput>) {
  const task = await prisma.repairTask.findUnique({ where: { id: taskId } });
  if (!task) throw notFound("Task");
  const job = await getJobForActor(actor, task.jobId);
  const isAssignee = task.assignedMechanicId === actor.userId;
  const supervisor = can(actor, "service.repair.assign");
  if (input.action === "UNBLOCK") {
    if (!supervisor && !isAssignee) throw forbidden();
  } else if (!(can(actor, "service.repair.work") && isAssignee) && !supervisor) {
    throw forbidden("Only the assigned mechanic (or a supervisor) can update this task.");
  }
  if (NEEDS_REASON.has(input.action) && (!input.reason || input.reason.length < 3)) throw invalid("A reason is required.");

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const j = await lockJob(tx, job.id);
    const t = await tx.repairTask.findUniqueOrThrow({ where: { id: taskId }, include: { dependencies: { include: { dependsOn: true } }, partRequests: true } });
    if (input.expectedVersion !== undefined && input.expectedVersion !== t.version) throw conflict("This task was updated by someone else. Refresh and try again.");
    const runMinutes = t.status === "IN_PROGRESS" && t.lastResumedAt ? Math.max(0, Math.round((now.getTime() - t.lastResumedAt.getTime()) / 60_000)) : 0;
    let to: RepairTaskStatus;
    const data: Record<string, unknown> = {};
    switch (input.action) {
      case "START":
      case "RESUME": {
        if (!(input.action === "START" ? ["READY"] : ["PAUSED"]).includes(t.status)) throw rule(`A ${t.status.toLowerCase()} task cannot be ${input.action === "START" ? "started" : "resumed"}.`);
        if (!t.assignedMechanicId) throw rule("Assign a mechanic before starting this task.");
        const depsDone = t.dependencies.every((d) => d.dependsOn.status === "COMPLETED" || d.dependsOn.status === "CANCELLED");
        const partsIssued = t.partRequests.every((r) => r.status === "ISSUED" || r.status === "CANCELLED");
        const blocker = startBlocker(t, j, depsDone, partsIssued);
        if (blocker) throw rule(blocker);
        to = "IN_PROGRESS";
        data.lastResumedAt = now;
        if (!t.startedAt) data.startedAt = now;
        break;
      }
      case "PAUSE":
        if (t.status !== "IN_PROGRESS") throw rule("Only an in-progress task can be paused.");
        to = "PAUSED";
        data.workedMinutes = t.workedMinutes + runMinutes;
        data.lastResumedAt = null;
        data.holdReason = input.reason;
        break;
      case "BLOCK":
        if (!["READY", "IN_PROGRESS", "PAUSED", "PENDING"].includes(t.status)) throw rule("This task cannot be blocked.");
        to = "BLOCKED";
        data.workedMinutes = t.workedMinutes + runMinutes;
        data.lastResumedAt = null;
        data.holdReason = input.reason;
        break;
      case "UNBLOCK":
        if (t.status !== "BLOCKED") throw rule("This task is not blocked.");
        if (t.partRequests.some((r) => r.status === "UNAVAILABLE" || r.status === "AWAITING_PROCUREMENT")) throw rule("Spare parts for this task are still unavailable.");
        to = "PENDING";
        data.holdReason = null;
        break;
      case "COMPLETE":
        if (t.status !== "IN_PROGRESS") throw rule("Start the task before completing it.");
        to = "COMPLETED";
        data.workedMinutes = t.workedMinutes + runMinutes;
        data.lastResumedAt = null;
        data.completedAt = now;
        data.holdReason = null;
        break;
    }
    const res = await tx.repairTask.updateMany({ where: { id: taskId, version: t.version }, data: { ...data, status: to, version: { increment: 1 } } });
    if (!res.count) throw conflict("This task was updated by someone else. Refresh and try again.");
    await tx.mechanicWorkLog.create({ data: { taskId, mechanicId: actor.userId, fromStatus: t.status, toStatus: to, reason: input.reason ?? null, minutesWorked: runMinutes } });
    await activity(tx, job.branchId, job.id, actor.userId, `task.${input.action.toLowerCase()}`, { taskId, title: t.title, reason: input.reason ?? null });

    // Job-level consequences.
    if (to === "IN_PROGRESS" && ["APPROVED", "PARTS_PENDING"].includes(j.status)) {
      await setJobStatus(tx, j, "IN_REPAIR");
    }
    if (to === "IN_PROGRESS" && input.action === "START") {
      const first = await tx.serviceTimelineEvent.findFirst({ where: { jobId: job.id, stage: "REPAIR_IN_PROGRESS" } });
      if (!first) await timeline(tx, job.id, { stage: "REPAIR_IN_PROGRESS", state: "ACTIVE", title: "Repair work has started", actor, nextExpectedAction: "Quality inspection after repairs." });
    }
    if (input.action === "PAUSE" || input.action === "BLOCK") {
      await notifyUsers(tx, [j.serviceAdvisorId], { type: "REPAIR_PAUSED", title: `${t.title} ${to.toLowerCase()} — ${j.jobNumber}`, body: input.reason ?? "", link: `/service/${job.id}`, branchId: job.branchId });
    }
    if (input.action === "UNBLOCK" || to === "COMPLETED") await refreshTaskReadiness(tx, job.id, actor.userId);
    if (to === "COMPLETED") {
      const remaining = await tx.repairTask.count({ where: { jobId: job.id, status: { notIn: ["COMPLETED", "CANCELLED"] } } });
      const pendingApproval = await tx.repairEstimate.count({ where: { jobId: job.id, status: { in: ["DRAFT", "SENT"] } } });
      if (!remaining && !pendingApproval && ["IN_REPAIR", "APPROVED", "PARTS_PENDING"].includes(j.status)) {
        await setJobStatus(tx, j, "QUALITY_CHECK");
        await timeline(tx, job.id, { stage: "REPAIR_IN_PROGRESS", state: "COMPLETED", title: "Repairs completed", actor });
        await timeline(tx, job.id, { stage: "QUALITY_INSPECTION", state: "ACTIVE", title: "Quality inspection in progress", nextExpectedAction: "Safety checks and test ride." });
        const { branchUsersWithRoles } = await import("@/lib/notifications");
        const inspectors = await branchUsersWithRoles(tx, job.branchId, ["QUALITY_INSPECTOR"]);
        await notifyUsers(tx, [...inspectors, j.serviceAdvisorId], { type: "QC_DUE", title: `Ready for QC — ${j.jobNumber}`, body: "All repair tasks are complete.", link: `/service/${job.id}`, branchId: job.branchId });
      }
    }
    await recalcEta(tx, job.id);
  });
  afterCommit(job.id);
}

/** Mechanic task board: tasks assigned to me (mechanics) or to the branch (supervisors). */
export async function mechanicBoard(actor: Actor, branchId?: string) {
  if (!can(actor, "service.repair.work") && !can(actor, "service.repair.assign")) throw forbidden();
  const mine = !can(actor, "service.repair.assign");
  return prisma.repairTask.findMany({
    where: {
      ...branchFilter(actor, branchId),
      ...(mine ? { assignedMechanicId: actor.userId } : {}),
      status: { notIn: ["CANCELLED"] },
      job: { status: { notIn: ["DELIVERED", "CLOSED", "CANCELLED"] } },
      OR: [{ status: { not: "COMPLETED" } }, { completedAt: { gte: new Date(Date.now() - 24 * 3600_000) } }],
    },
    orderBy: [{ status: "asc" }, { isSafetyCritical: "desc" }, { createdAt: "asc" }],
    include: {
      assignedMechanic: { select: { id: true, name: true } },
      job: { select: { id: true, jobNumber: true, isEmergency: true, customerVehicle: { select: { registrationNumber: true, modelName: true } } } },
      partRequests: { select: { status: true, quantity: true, item: { select: { name: true } } } },
      dependencies: { select: { dependsOn: { select: { title: true, status: true } } } },
    },
  });
}
