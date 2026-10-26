import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { forbidden, invalid, notFound, rule } from "@/lib/errors";
import { can, requirePermission, type Actor } from "@/lib/rbac/actor";
import { audit } from "@/lib/audit";
import { nextNumber } from "@/lib/numbering";
import { D, calcLine, round2, sum, ZERO } from "@/lib/money";
import { notifyUsers, queueCustomerMessage } from "@/lib/notifications";
import { getBranchSetting, getDuration } from "../settings";
import { activity, afterCommit, assertJobOpen, getJobForActor, lockJob, setJobStatus, templateValues, timeline, type JobWithRefs } from "./common";
import { recalcEta } from "./eta";
import { refreshTaskReadiness } from "./repairs";

const taskInput = z.object({
  title: z.string().trim().min(3).max(160),
  taskKey: z.string().trim().max(60).optional(),
  description: z.string().trim().max(1000).optional(),
  minMinutes: z.coerce.number().int().min(5).max(60 * 24 * 10).optional(),
  maxMinutes: z.coerce.number().int().min(5).max(60 * 24 * 10).optional(),
  labourCharge: z.coerce.number().min(0).max(1_000_000),
  isOptional: z.boolean().default(false),
  isSafetyCritical: z.boolean().default(false),
  dependsOn: z.array(z.number().int().min(0)).default([]),
  parts: z.array(z.object({ itemId: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(1000) })).max(30).default([]),
});

export const inspectionInput = z.object({
  checklist: z
    .array(z.object({ key: z.string(), label: z.string(), result: z.enum(["OK", "ATTENTION", "FAIL", "NA"]), notes: z.string().max(500).optional() }))
    .max(80)
    .default([]),
  findings: z.string().trim().max(4000).optional(),
  safetyCritical: z.boolean().default(false),
  customerSummary: z.string().trim().max(2000).optional(),
  internalNotes: z.string().trim().max(4000).optional(),
  tasks: z.array(taskInput).max(40),
});

export async function startInspection(actor: Actor, jobId: string, examinerId?: string) {
  requirePermission(actor, "service.inspect", "service.job.manage");
  const job = await getJobForActor(actor, jobId);
  await prisma.$transaction(async (tx) => {
    const j = await lockJob(tx, jobId);
    if (j.status !== "RECEIVED") throw rule("Inspection has already started for this job.");
    const examiner = examinerId ?? actor.userId;
    if (examiner !== actor.userId) {
      const ok = await tx.userBranchAssignment.findFirst({ where: { userId: examiner, branchId: job.branchId } });
      if (!ok) throw invalid("Examiner is not assigned to this branch.");
    }
    await tx.serviceInspection.create({ data: { jobId, examinerId: examiner } });
    await tx.serviceJobAssignment.create({ data: { jobId, userId: examiner, role: "EXAMINER", assignedById: actor.userId } });
    await setJobStatus(tx, j, "INSPECTION");
    const ex = await tx.user.findUniqueOrThrow({ where: { id: examiner }, select: { name: true } });
    await timeline(tx, jobId, {
      stage: "INSPECTION_IN_PROGRESS",
      state: "ACTIVE",
      title: "Our technician is inspecting your vehicle",
      actor: { ...actor, name: ex.name },
      nextExpectedAction: "You'll receive an estimate once the inspection is complete.",
    });
    await activity(tx, job.branchId, jobId, actor.userId, "inspection.started", { examinerId: examiner });
  });
  afterCommit(jobId);
}

async function labourTaxRate(tx: Tx, branchId: string) {
  return Number(await getBranchSetting(tx, branchId, "billing.labourTaxPercent"));
}

/** Create repair tasks (+ dependencies) and, for chargeable work, a DRAFT estimate. */
async function createTasksAndEstimate(
  tx: Tx,
  actor: Actor,
  job: JobWithRefs,
  tasks: z.infer<typeof taskInput>[],
  origin: "INITIAL" | "SUPPLEMENTARY",
) {
  const warranty = job.serviceType === "WARRANTY_REPAIR";
  const labourTax = await labourTaxRate(tx, job.branchId);
  const items = await tx.inventoryItem.findMany({
    where: { id: { in: tasks.flatMap((t) => t.parts.map((p) => p.itemId)) }, businessUnitId: job.branch.businessUnitId, isActive: true },
  });
  const itemById = new Map(items.map((i) => [i.id, i]));
  const baseSeq = await tx.repairTask.count({ where: { jobId: job.id } });

  const created: { id: string; chargeable: boolean; input: z.infer<typeof taskInput> }[] = [];
  for (const [i, t] of tasks.entries()) {
    for (const p of t.parts) if (!itemById.has(p.itemId)) throw invalid(`Part not found for task "${t.title}".`);
    let min = t.minMinutes;
    let max = t.maxMinutes;
    if ((!min || !max) && t.taskKey) {
      const std = await getDuration(tx, { businessUnitId: job.branch.businessUnitId, branchId: job.branchId, vehicleModelId: job.customerVehicle.vehicleModelId, taskKey: t.taskKey });
      min ??= std?.minMinutes;
      max ??= std?.maxMinutes;
    }
    if (!min || !max) throw invalid(`Enter a duration range for "${t.title}".`);
    if (max < min) throw invalid(`Maximum duration must be at least the minimum for "${t.title}".`);
    const partsValue = warranty ? ZERO : sum(t.parts.map((p) => D(itemById.get(p.itemId)!.sellingPrice).times(p.quantity)));
    const chargeable = !warranty && (t.labourCharge > 0 || partsValue.greaterThan(0));
    const task = await tx.repairTask.create({
      data: {
        jobId: job.id,
        branchId: job.branchId,
        taskKey: t.taskKey ?? null,
        title: t.title,
        description: t.description ?? null,
        origin,
        requiresApproval: chargeable,
        approved: !chargeable,
        isOptional: t.isOptional,
        isSafetyCritical: t.isSafetyCritical,
        estimatedMinMinutes: min,
        estimatedMaxMinutes: max,
        labourCharge: warranty ? 0 : t.labourCharge,
        sequence: baseSeq + i,
      },
    });
    created.push({ id: task.id, chargeable, input: t });
  }
  for (const [i, t] of tasks.entries()) {
    for (const d of t.dependsOn) {
      if (d === i || !created[d]) throw invalid(`Invalid dependency on task "${t.title}".`);
      await tx.repairTaskDependency.create({ data: { taskId: created[i].id, dependsOnTaskId: created[d].id } });
    }
  }

  // Lines for every task. Non-chargeable tasks (warranty/free) still list parts at zero so the
  // billing executive can verify and request them.
  const lines: Prisma.EstimateLineItemCreateManyEstimateInput[] = [];
  for (const c of created) {
    const t = c.input;
    if (t.labourCharge > 0 || c.chargeable || t.parts.length === 0) {
      const l = calcLine({ quantity: 1, unitPrice: warranty ? 0 : t.labourCharge, taxRatePercent: labourTax });
      lines.push({ repairTaskId: c.id, type: "LABOUR", description: t.title, quantity: 1, unitPrice: warranty ? 0 : t.labourCharge, taxRatePercent: labourTax, taxAmount: l.tax, lineTotal: l.total, isOptional: t.isOptional, approvalStatus: c.chargeable ? "PENDING" : "APPROVED" });
    }
    for (const p of t.parts) {
      const item = itemById.get(p.itemId)!;
      const price = warranty ? ZERO : D(item.sellingPrice);
      const l = calcLine({ quantity: p.quantity, unitPrice: price, taxRatePercent: item.taxRatePercent });
      lines.push({ repairTaskId: c.id, type: "PART", description: `${item.name} (${item.partNumber})`, inventoryItemId: item.id, quantity: p.quantity, unitPrice: price, taxRatePercent: item.taxRatePercent, taxAmount: l.tax, lineTotal: l.total, isOptional: t.isOptional, approvalStatus: c.chargeable ? "PENDING" : "APPROVED" });
    }
  }
  if (!lines.length) return { estimateId: null, anyChargeable: false };
  const estimateNumber = await nextNumber(tx, "EST", job.branch.businessUnit.code);
  const est = await tx.repairEstimate.create({
    data: {
      estimateNumber,
      jobId: job.id,
      kind: origin,
      status: created.some((c) => c.chargeable) ? "DRAFT" : "APPROVED",
      preparedById: actor.userId,
      decidedAt: created.some((c) => c.chargeable) ? null : new Date(),
      lines: { createMany: { data: lines } },
    },
  });
  await recomputeEstimateTotals(tx, est.id);
  return { estimateId: est.id, anyChargeable: created.some((c) => c.chargeable) };
}

export async function recomputeEstimateTotals(tx: Tx, estimateId: string) {
  const lines = await tx.estimateLineItem.findMany({ where: { estimateId } });
  const labour = sum(lines.filter((l) => l.type === "LABOUR").map((l) => D(l.unitPrice).times(l.quantity)));
  const parts = sum(lines.filter((l) => l.type !== "LABOUR").map((l) => D(l.unitPrice).times(l.quantity)));
  const discount = sum(lines.map((l) => l.discount));
  const tax = sum(lines.map((l) => l.taxAmount));
  const grand = sum(lines.map((l) => l.lineTotal));
  const approved = sum(lines.filter((l) => l.approvalStatus === "APPROVED").map((l) => l.lineTotal));
  await tx.repairEstimate.update({
    where: { id: estimateId },
    data: { labourTotal: round2(labour), partsTotal: round2(parts), discountTotal: round2(discount), taxTotal: round2(tax), grandTotal: round2(grand), approvedTotal: round2(approved) },
  });
}

export async function completeInspection(actor: Actor, jobId: string, input: z.infer<typeof inspectionInput>) {
  requirePermission(actor, "service.inspect");
  const job = await getJobForActor(actor, jobId);
  await prisma.$transaction(async (tx) => {
    const j = await lockJob(tx, jobId);
    if (!["RECEIVED", "INSPECTION"].includes(j.status)) throw rule("The inspection for this job is already complete.");
    let insp = await tx.serviceInspection.findFirst({ where: { jobId, completedAt: null }, orderBy: { startedAt: "desc" } });
    if (!insp) {
      insp = await tx.serviceInspection.create({ data: { jobId, examinerId: actor.userId } });
      await tx.serviceJobAssignment.create({ data: { jobId, userId: actor.userId, role: "EXAMINER", assignedById: actor.userId } });
      await setJobStatus(tx, j, "INSPECTION");
      await timeline(tx, jobId, { stage: "INSPECTION_IN_PROGRESS", state: "ACTIVE", title: "Our technician is inspecting your vehicle", actor });
    }
    await tx.serviceInspection.update({
      where: { id: insp.id },
      data: {
        checklist: input.checklist,
        findings: input.findings,
        safetyCritical: input.safetyCritical,
        customerSummary: input.customerSummary,
        internalNotes: input.internalNotes,
        completedAt: new Date(),
      },
    });
    const { anyChargeable } = await createTasksAndEstimate(tx, actor, j, input.tasks, "INITIAL");
    await timeline(tx, jobId, {
      stage: "INSPECTION_COMPLETED",
      state: "COMPLETED",
      title: "Inspection completed",
      customerNote: input.customerSummary ?? null,
      actor,
      nextExpectedAction: anyChargeable ? "Your service advisor will share the estimate for approval." : "Repairs will be scheduled.",
    });
    if (!anyChargeable) {
      await setJobStatus(tx, j, input.tasks.length ? "APPROVED" : "FINAL_BILLING");
      await refreshTaskReadiness(tx, jobId, actor.userId);
    }
    await activity(tx, job.branchId, jobId, actor.userId, "inspection.completed", { tasks: input.tasks.length, safetyCritical: input.safetyCritical });
    await recalcEta(tx, jobId);
    await notifyUsers(tx, [j.serviceAdvisorId], { type: "INSPECTION_COMPLETED", title: `Inspection completed — ${j.jobNumber}`, body: anyChargeable ? "Review and send the estimate." : "No chargeable work found.", link: `/service/${jobId}`, branchId: job.branchId });
  });
  afterCommit(jobId);
}

export const supplementaryInput = z.object({ reason: z.string().trim().min(5).max(1000), tasks: z.array(taskInput).min(1).max(20) });

/** Additional work found during repair: new tasks + SUPPLEMENTARY estimate (draft). */
export async function addSupplementaryWork(actor: Actor, jobId: string, input: z.infer<typeof supplementaryInput>) {
  if (!can(actor, "service.estimate.manage") && !can(actor, "service.repair.work")) throw forbidden();
  const job = await getJobForActor(actor, jobId);
  assertJobOpen(job);
  if (!["APPROVED", "PARTS_PENDING", "IN_REPAIR", "QUALITY_CHECK", "AWAITING_APPROVAL"].includes(job.status)) {
    throw rule("Additional work can only be added after the initial estimate is decided.");
  }
  let estimateId: string | null = null;
  await prisma.$transaction(async (tx) => {
    const j = await lockJob(tx, jobId);
    const res = await createTasksAndEstimate(tx, actor, j, input.tasks.map((t) => ({ ...t, dependsOn: [] })), "SUPPLEMENTARY");
    estimateId = res.estimateId;
    await activity(tx, job.branchId, jobId, actor.userId, "supplementary.created", { reason: input.reason, tasks: input.tasks.map((t) => t.title) });
    if (!res.anyChargeable) await refreshTaskReadiness(tx, jobId, actor.userId);
    await recalcEta(tx, jobId);
    await notifyUsers(tx, [j.serviceAdvisorId], { type: "SUPPLEMENTARY_WORK", title: `Additional work proposed — ${j.jobNumber}`, body: input.reason, link: `/service/${jobId}`, branchId: job.branchId });
  });
  afterCommit(jobId);
  return { estimateId };
}

// ─── Estimates ───

export const lineDiscountInput = z.object({ discount: z.coerce.number().min(0).max(1_000_000) });

export async function updateEstimateLineDiscount(actor: Actor, lineId: string, input: z.infer<typeof lineDiscountInput>) {
  requirePermission(actor, "service.estimate.manage");
  const line = await prisma.estimateLineItem.findUnique({ where: { id: lineId }, include: { estimate: true } });
  if (!line) throw notFound("Estimate line");
  const job = await getJobForActor(actor, line.estimate.jobId);
  if (line.estimate.status !== "DRAFT") throw rule("Only draft estimates can be edited. Create a new estimate instead.");
  const gross = D(line.unitPrice).times(line.quantity);
  if (D(input.discount).greaterThan(gross)) throw invalid("Discount cannot exceed the line value.");
  const limit = Number(await getBranchSetting(prisma, job.branchId, "service.discountApprovalLimitPercent"));
  if (gross.greaterThan(0) && D(input.discount).dividedBy(gross).times(100).greaterThan(limit) && !can(actor, "service.discount.approve")) {
    throw forbidden(`Discounts above ${limit}% need branch manager approval.`);
  }
  await prisma.$transaction(async (tx) => {
    const l = calcLine({ quantity: line.quantity, unitPrice: line.unitPrice, discount: input.discount, taxRatePercent: line.taxRatePercent });
    await tx.estimateLineItem.update({ where: { id: lineId }, data: { discount: l.discount, taxAmount: l.tax, lineTotal: l.total } });
    await recomputeEstimateTotals(tx, line.estimateId);
    await audit(tx, { actorId: actor.userId, action: "estimate.line.discount", entityType: "EstimateLineItem", entityId: lineId, branchId: job.branchId, before: { discount: line.discount }, after: { discount: input.discount } });
  });
}

export async function sendEstimate(actor: Actor, estimateId: string, note?: string) {
  requirePermission(actor, "service.estimate.manage");
  const est = await prisma.repairEstimate.findUnique({ where: { id: estimateId } });
  if (!est) throw notFound("Estimate");
  const job = await getJobForActor(actor, est.jobId);
  await prisma.$transaction(async (tx) => {
    const j = await lockJob(tx, job.id);
    const e = await tx.repairEstimate.findUniqueOrThrow({ where: { id: estimateId } });
    if (e.status !== "DRAFT") throw rule("This estimate has already been sent.");
    await recalcEta(tx, job.id);
    const eta = await tx.serviceJob.findUniqueOrThrow({ where: { id: job.id }, select: { etaLatest: true } });
    await tx.repairEstimate.update({ where: { id: estimateId }, data: { status: "SENT", sentAt: new Date(), customerNote: note ?? null, expectedCompletionAt: eta.etaLatest } });
    await setJobStatus(tx, j, "AWAITING_APPROVAL");
    await timeline(tx, job.id, {
      stage: "ESTIMATE_AWAITING_APPROVAL",
      state: "ACTIVE",
      title: e.kind === "SUPPLEMENTARY" ? "Additional work needs your approval" : "Your estimate is ready for approval",
      customerNote: note ?? null,
      actor,
      nextExpectedAction: "Review and approve the estimate. Chargeable work starts only after your approval.",
    });
    await audit(tx, { actorId: actor.userId, action: "estimate.send", entityType: "RepairEstimate", entityId: estimateId, branchId: job.branchId, after: { total: e.grandTotal } });
    const { formatINR } = await import("@/lib/money");
    await queueCustomerMessage(tx, {
      templateKey: "ESTIMATE_READY",
      businessUnitId: job.branch.businessUnitId,
      values: templateValues(j, { estimate_total: formatINR(e.grandTotal) }),
      email: job.customer.email,
      customerId: job.customerId,
      branchId: job.branchId,
      serviceJobId: job.id,
    });
    if (job.customer.userId) {
      await notifyUsers(tx, [job.customer.userId], { type: "ESTIMATE_READY", title: "Estimate ready for approval", body: `${job.jobNumber}: please review the estimate.`, link: `/portal/jobs/${job.id}` });
    }
  });
  afterCommit(job.id);
}

export const decisionInput = z.object({
  decisions: z.array(z.object({ lineId: z.string().uuid(), decision: z.enum(["APPROVED", "REJECTED"]) })).min(1).max(200),
  channel: z.enum(["PORTAL", "IN_PERSON", "PHONE"]).default("PORTAL"),
  notes: z.string().trim().max(500).optional(),
});

/**
 * Customer decision on an estimate. Customers decide in the portal for their own jobs only;
 * staff may record a decision given in person/by phone (permission + audit).
 */
export async function decideEstimate(actor: Actor, estimateId: string, input: z.infer<typeof decisionInput>) {
  const est = await prisma.repairEstimate.findUnique({ where: { id: estimateId } });
  if (!est) throw notFound("Estimate");
  const job = await getJobForActor(actor, est.jobId); // customers: own jobs only
  if (actor.kind === "CUSTOMER") {
    if (input.channel !== "PORTAL") throw invalid("Invalid approval channel.");
  } else {
    requirePermission(actor, "service.estimate.record_approval");
    if (input.channel === "PORTAL") throw invalid("Staff must record whether approval was given in person or by phone.");
  }
  const { currentMeta } = await import("@/lib/request-context");
  await prisma.$transaction(async (tx) => {
    const j = await lockJob(tx, job.id);
    const e = await tx.repairEstimate.findUniqueOrThrow({ where: { id: estimateId }, include: { lines: true } });
    if (e.status !== "SENT") throw rule("This estimate is not awaiting a decision.");
    const pending = e.lines.filter((l) => l.approvalStatus === "PENDING");
    const given = new Map(input.decisions.map((d) => [d.lineId, d.decision]));
    for (const id of given.keys()) if (!e.lines.some((l) => l.id === id)) throw invalid("Decision for an unknown estimate line.");
    if (pending.some((l) => !given.has(l.id))) throw invalid("Please approve or reject every item on the estimate.");

    // A rejected task (its labour line) rejects that task's parts too.
    const rejectedTasks = new Set(pending.filter((l) => l.type === "LABOUR" && given.get(l.id) === "REJECTED").map((l) => l.repairTaskId));
    const tasksWithApproval = new Map<string, boolean>();
    for (const l of pending) {
      let d = given.get(l.id)!;
      if (l.repairTaskId && rejectedTasks.has(l.repairTaskId)) d = "REJECTED";
      if (d === "REJECTED" && !l.isOptional && l.type !== "LABOUR" && l.repairTaskId && !rejectedTasks.has(l.repairTaskId)) {
        // Rejecting a required part while approving its labour is not workable.
        throw invalid(`"${l.description}" is required for its repair. Reject the repair itself instead.`);
      }
      await tx.estimateLineItem.update({ where: { id: l.id }, data: { approvalStatus: d } });
      await tx.customerApproval.create({
        data: {
          estimateId,
          lineItemId: l.id,
          decision: d,
          channel: input.channel,
          decidedByUserId: actor.kind === "CUSTOMER" ? actor.userId : null,
          recordedByUserId: actor.kind === "STAFF" ? actor.userId : null,
          notes: input.notes ?? null,
          ipAddress: currentMeta().ip,
        },
      });
      if (l.repairTaskId) tasksWithApproval.set(l.repairTaskId, (tasksWithApproval.get(l.repairTaskId) ?? true) && d === "APPROVED");
    }
    for (const [taskId, ok] of tasksWithApproval) {
      await tx.repairTask.update({ where: { id: taskId }, data: ok ? { approved: true } : { status: "CANCELLED", approved: false } });
    }
    const after = await tx.estimateLineItem.findMany({ where: { estimateId } });
    const approvedCount = after.filter((l) => l.approvalStatus === "APPROVED").length;
    const status = approvedCount === 0 ? "REJECTED" : approvedCount === after.length ? "APPROVED" : "PARTIALLY_APPROVED";
    await tx.repairEstimate.update({ where: { id: estimateId }, data: { status, decidedAt: new Date() } });
    await recomputeEstimateTotals(tx, estimateId);

    const tasks = await tx.repairTask.findMany({ where: { jobId: job.id } });
    const live = tasks.filter((t) => t.status !== "CANCELLED");
    const started = tasks.some((t) => ["IN_PROGRESS", "PAUSED", "COMPLETED"].includes(t.status));
    const allDone = live.length > 0 && live.every((t) => t.status === "COMPLETED");
    if (j.status === "AWAITING_APPROVAL") {
      if (!live.length) await setJobStatus(tx, j, "FINAL_BILLING");
      else {
        await setJobStatus(tx, j, "APPROVED");
        if (allDone) await setJobStatus(tx, j, "QUALITY_CHECK");
        else if (started) await setJobStatus(tx, j, "IN_REPAIR");
      }
    }
    await refreshTaskReadiness(tx, job.id, actor.userId);
    await recalcEta(tx, job.id);
    await timeline(tx, job.id, {
      stage: "APPROVAL_RECEIVED",
      state: "COMPLETED",
      title: status === "REJECTED" ? "Estimate declined" : status === "APPROVED" ? "Estimate approved" : "Estimate partly approved",
      customerNote: status === "REJECTED" ? "No chargeable work will be carried out. Your advisor will contact you." : null,
      actor: actor.kind === "STAFF" ? actor : null,
      nextExpectedAction: live.length ? "We are checking spare-part availability." : "Your vehicle will be prepared for collection.",
    });
    await audit(tx, { actorId: actor.userId, action: "estimate.decide", entityType: "RepairEstimate", entityId: estimateId, branchId: job.branchId, after: { status, channel: input.channel } });
    await notifyUsers(tx, [j.serviceAdvisorId], { type: "ESTIMATE_DECIDED", title: `Estimate ${status.toLowerCase().replace("_", " ")} — ${j.jobNumber}`, body: "Verify parts and schedule the work.", link: `/service/${job.id}`, branchId: job.branchId });
  });
  afterCommit(job.id);
}
