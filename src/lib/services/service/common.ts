import type { Prisma, ServiceJobStatus } from "@prisma/client";
import { prisma, type Db, type Tx } from "@/lib/db";
import { forbidden, notFound, rule } from "@/lib/errors";
import { can, hasBranch, type Actor } from "@/lib/rbac/actor";
import { publishJobUpdate } from "@/lib/realtime";
import { ROLE_LABEL, type StageKey } from "@/lib/service/stages";
import { formatInTimeZone } from "date-fns-tz";

/**
 * Load a service job the actor is allowed to see.
 * - Staff: job's branch must be in scope; mechanics (service.view.assigned) only jobs they're assigned to.
 * - Customers: only their own jobs.
 * Out-of-scope jobs raise NOT_FOUND so existence is not disclosed.
 */
export async function getJobForActor(actor: Actor, jobId: string, db: Db = prisma) {
  const job = await db.serviceJob.findUnique({
    where: { id: jobId },
    include: { branch: { include: { businessUnit: true } }, customer: true, customerVehicle: true, serviceAdvisor: { select: { id: true, name: true, phone: true } } },
  });
  if (!job) throw notFound("Service job");
  if (actor.kind === "CUSTOMER") {
    if (!actor.customerId || job.customerId !== actor.customerId) throw notFound("Service job");
    return job;
  }
  if (!hasBranch(actor, job.branchId)) throw notFound("Service job");
  if (!can(actor, "service.view")) {
    if (!can(actor, "service.view.assigned")) throw notFound("Service job");
    const assigned = await db.serviceJobAssignment.findFirst({ where: { jobId, userId: actor.userId, releasedAt: null } });
    const task = assigned ? true : await db.repairTask.findFirst({ where: { jobId, assignedMechanicId: actor.userId } });
    if (!task) throw notFound("Service job");
  }
  return job;
}

export type JobWithRefs = Awaited<ReturnType<typeof getJobForActor>>;

/** Lock the job row and bump its version (serialises concurrent workflow steps on one job). */
export async function lockJob(tx: Tx, jobId: string) {
  await tx.$queryRaw`SELECT 1 FROM "ServiceJob" WHERE "id" = ${jobId}::uuid FOR UPDATE`;
  return tx.serviceJob.update({
    where: { id: jobId },
    data: { version: { increment: 1 } },
    include: { branch: { include: { businessUnit: true } }, customer: true, customerVehicle: true, serviceAdvisor: { select: { id: true, name: true, phone: true } } },
  });
}

const TRANSITIONS: Record<ServiceJobStatus, ServiceJobStatus[]> = {
  RECEIVED: ["INSPECTION", "CANCELLED"],
  INSPECTION: ["AWAITING_APPROVAL", "APPROVED", "CANCELLED", "FINAL_BILLING"],
  AWAITING_APPROVAL: ["APPROVED", "FINAL_BILLING", "CANCELLED"],
  APPROVED: ["PARTS_PENDING", "IN_REPAIR", "AWAITING_APPROVAL", "QUALITY_CHECK"],
  PARTS_PENDING: ["APPROVED", "IN_REPAIR", "AWAITING_APPROVAL", "QUALITY_CHECK"],
  IN_REPAIR: ["PARTS_PENDING", "QUALITY_CHECK", "AWAITING_APPROVAL"],
  QUALITY_CHECK: ["IN_REPAIR", "FINAL_BILLING", "AWAITING_APPROVAL"],
  FINAL_BILLING: ["READY_FOR_DELIVERY", "IN_REPAIR"],
  READY_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

export async function setJobStatus(tx: Tx, job: { id: string; status: ServiceJobStatus }, to: ServiceJobStatus, extra: Prisma.ServiceJobUpdateInput = {}) {
  if (job.status === to) {
    if (Object.keys(extra).length) await tx.serviceJob.update({ where: { id: job.id }, data: extra });
    return;
  }
  if (!TRANSITIONS[job.status].includes(to)) throw rule(`A job cannot move from ${job.status} to ${to}.`);
  await tx.serviceJob.update({ where: { id: job.id }, data: { status: to, ...extra } });
  job.status = to;
}

export function assertJobOpen(job: { status: ServiceJobStatus }) {
  if (["DELIVERED", "CLOSED", "CANCELLED"].includes(job.status)) throw rule("This service job is already closed.");
}

/** Customer-visible timeline entry. Write text for the customer; never internal notes. */
export async function timeline(
  tx: Tx,
  jobId: string,
  e: { stage: StageKey; state: "COMPLETED" | "ACTIVE" | "BLOCKED" | "FAILED" | "INFO"; title: string; customerNote?: string | null; actor?: Actor | null; nextExpectedAction?: string | null },
) {
  const job = await tx.serviceJob.findUniqueOrThrow({ where: { id: jobId }, select: { etaEarliest: true, etaLatest: true } });
  await tx.serviceTimelineEvent.create({
    data: {
      jobId,
      stage: e.stage,
      state: e.state,
      title: e.title,
      customerNote: e.customerNote ?? null,
      actorName: e.actor?.name ?? null,
      actorRole: e.actor ? (e.actor.roles.map((r) => ROLE_LABEL[r]).find(Boolean) ?? null) : null,
      nextExpectedAction: e.nextExpectedAction ?? null,
      etaEarliest: job.etaEarliest,
      etaLatest: job.etaLatest,
    },
  });
}

export async function activity(tx: Tx, branchId: string, jobId: string | null, actorId: string | null, action: string, details?: Prisma.InputJsonValue) {
  await tx.internalActivityLog.create({ data: { branchId, jobId, actorId, action, details } });
}

export function requireStaff(actor: Actor) {
  if (actor.kind !== "STAFF") throw forbidden();
}

/** Values for message templates — always from real records. */
export function templateValues(job: JobWithRefs, extra: Record<string, string | null | undefined> = {}) {
  const tz = job.branch.timezone;
  const fmt = (d: Date | null) => (d ? formatInTimeZone(d, tz, "d MMM yyyy, h:mm a") : null);
  const eta =
    job.etaEarliest && job.etaLatest
      ? fmt(job.etaEarliest) === fmt(job.etaLatest)
        ? fmt(job.etaLatest)
        : `between ${fmt(job.etaEarliest)} and ${fmt(job.etaLatest)}`
      : "to be confirmed by your service advisor";
  return {
    customer_name: job.customer.fullName,
    vehicle_model: job.customerVehicle.modelName,
    job_number: job.jobNumber,
    branch_name: job.branch.name,
    branch_contact: job.branch.phone,
    service_advisor_name: job.serviceAdvisor.name,
    estimated_completion: eta,
    ...extra,
  };
}

/** After commit: push realtime update to SSE subscribers. */
export function afterCommit(jobId: string) {
  publishJobUpdate(jobId);
}
