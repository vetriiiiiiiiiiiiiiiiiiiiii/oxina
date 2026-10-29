import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { forbidden, invalid, notFound, rule } from "@/lib/errors";
import { assertBranch, branchFilter, requirePermission, type Actor } from "@/lib/rbac/actor";
import { audit } from "@/lib/audit";
import { D } from "@/lib/money";
import { notifyUsers, queueCustomerMessage } from "@/lib/notifications";
import { buildStageView } from "@/lib/service/stages";
import { applyStockChange } from "../stock";
import { getBranchSetting } from "../settings";
import { activity, afterCommit, getJobForActor, lockJob, setJobStatus, templateValues, timeline } from "./common";
import { qualityGatePassed } from "./quality";
import { refreshEtaIfStale } from "./eta";

/** Stage 9. Requires passed QC (when work was done) and a finalized invoice. */
export async function markReadyForDelivery(actor: Actor, jobId: string, pickupInstructions?: string) {
  requirePermission(actor, "service.handover");
  const job = await getJobForActor(actor, jobId);
  await prisma.$transaction(async (tx) => {
    const j = await lockJob(tx, jobId);
    if (j.status !== "FINAL_BILLING") throw rule("A vehicle is marked ready after quality inspection and final billing.");
    if (!(await qualityGatePassed(tx, jobId))) throw rule("Mandatory quality and safety checks have not passed.");
    const inv = await tx.invoice.findFirst({ where: { serviceJobId: jobId, status: { in: ["FINALIZED", "PARTIALLY_PAID", "PAID"] } } });
    if (!inv) throw rule("Finalize the invoice before marking the vehicle ready.");
    const openParts = await tx.sparePartRequest.count({ where: { jobId, status: { in: ["RESERVED", "PICKING", "PICKED"] } } });
    if (openParts) throw rule("Some reserved parts have not been issued or released.");
    await setJobStatus(tx, j, "READY_FOR_DELIVERY", { readyAt: new Date(), etaEarliest: null, etaLatest: null, etaConfidence: null });
    await timeline(tx, jobId, {
      stage: "READY_FOR_DELIVERY",
      state: "ACTIVE",
      title: "Your vehicle is ready for collection",
      customerNote: pickupInstructions ?? `Please collect your vehicle from ${job.branch.name}. Bring your job number ${job.jobNumber}.`,
      actor,
      nextExpectedAction: D(inv.balanceDue).greaterThan(0) ? "Settle the outstanding balance at pickup." : "Collect your vehicle.",
    });
    await queueCustomerMessage(tx, { templateKey: "READY_FOR_DELIVERY", businessUnitId: job.branch.businessUnitId, values: templateValues(j), email: job.customer.email, customerId: job.customerId, branchId: job.branchId, serviceJobId: jobId });
    if (job.customer.userId) await notifyUsers(tx, [job.customer.userId], { type: "READY_FOR_DELIVERY", title: "Your vehicle is ready", body: `${job.customerVehicle.modelName} is ready for collection at ${job.branch.name}.`, link: `/portal/jobs/${jobId}` });
    await activity(tx, job.branchId, jobId, actor.userId, "job.ready", {});
  });
  afterCommit(jobId);
}

export const handoverInput = z.object({
  recipientName: z.string().trim().min(2).max(120),
  recipientRelation: z.enum(["OWNER", "FAMILY", "AUTHORIZED_PERSON", "DRIVER"]),
  odometerOut: z.coerce.number().int().min(0),
  checklist: z.object({
    vehicleInspectedWithCustomer: z.boolean(),
    accessoriesReturned: z.boolean(),
    invoiceExplained: z.boolean(),
    oldPartsOffered: z.boolean(),
  }),
  customerAcknowledged: z.boolean(),
  notes: z.string().trim().max(1000).optional(),
});

/** Stage 10 — handover and closure. */
export async function handoverVehicle(actor: Actor, jobId: string, input: z.infer<typeof handoverInput>) {
  requirePermission(actor, "service.handover");
  const job = await getJobForActor(actor, jobId);
  await prisma.$transaction(async (tx) => {
    const j = await lockJob(tx, jobId);
    if (j.status !== "READY_FOR_DELIVERY") throw rule("Only vehicles marked ready for delivery can be handed over.");
    if (!(await qualityGatePassed(tx, jobId))) throw rule("Mandatory quality and safety checks have not passed.");
    if (input.odometerOut < j.odometerIn) throw invalid(`Odometer cannot be below the intake reading (${j.odometerIn} km).`);
    if (!input.customerAcknowledged) throw invalid("The customer (or authorised recipient) must acknowledge the handover.");
    if (!input.checklist.vehicleInspectedWithCustomer || !input.checklist.accessoriesReturned) throw invalid("Complete the mandatory handover checklist items.");
    const inv = await tx.invoice.findFirst({ where: { serviceJobId: jobId, status: { not: "CANCELLED" } } });
    if (!inv || inv.status === "DRAFT") throw rule("The invoice must be finalized before handover.");
    const pendingPayments = await tx.payment.count({ where: { invoiceId: inv.id, status: "PENDING_CONFIRMATION" } });
    const allowBalance = await getBranchSetting(tx, job.branchId, "service.allowDeliveryWithBalance");
    if (D(inv.balanceDue).greaterThan(0) && !allowBalance) {
      throw rule(pendingPayments ? "A payment is awaiting confirmation. Confirm it before handover." : "The invoice has an outstanding balance. Record and confirm payment before handover.");
    }

    // Release any reservations still held for this job (e.g. optional parts never fitted).
    const leftovers = await tx.stockReservation.findMany({ where: { status: "ACTIVE", sparePartRequest: { jobId } } });
    for (const r of leftovers) {
      await applyStockChange(tx, { itemId: r.itemId, locationId: r.locationId, branchId: r.branchId, type: "RELEASE", reserved: -r.quantity, performedById: actor.userId, referenceType: "SERVICE_JOB", referenceId: jobId, serviceJobId: jobId, reason: "Job closed" });
      await tx.stockReservation.update({ where: { id: r.id }, data: { status: "RELEASED", closedAt: new Date() } });
    }
    await tx.sparePartRequest.updateMany({ where: { jobId, status: { notIn: ["ISSUED", "CANCELLED"] } }, data: { status: "CANCELLED" } });

    const now = new Date();
    await tx.serviceHandover.create({
      data: { jobId, handedOverById: actor.userId, recipientName: input.recipientName, recipientRelation: input.recipientRelation, odometerOut: input.odometerOut, checklist: input.checklist, customerAcknowledged: input.customerAcknowledged, notes: input.notes },
    });
    await tx.customerVehicle.update({ where: { id: j.customerVehicleId }, data: { lastOdometer: input.odometerOut } });
    await setJobStatus(tx, j, "DELIVERED", { deliveredAt: now, odometerOut: input.odometerOut });
    await timeline(tx, jobId, { stage: "READY_FOR_DELIVERY", state: "COMPLETED", title: "Ready for delivery" });
    await timeline(tx, jobId, { stage: "DELIVERED", state: "COMPLETED", title: `Vehicle handed over to ${input.recipientName}`, actor, nextExpectedAction: "We'll check in with you tomorrow. Please share your feedback." });

    // Closure conditions: delivered, invoice finalized, no open parts — then close.
    await setJobStatus(tx, j, "CLOSED", { closedAt: now });

    // Stage 11 — follow-ups.
    const reminderDays = Number(await getBranchSetting(tx, job.branchId, "followup.serviceReminderDays"));
    const day = 24 * 3600_000;
    await tx.followUp.createMany({
      data: [
        { type: "NEXT_DAY", dueAt: new Date(now.getTime() + day) },
        { type: "THREE_DAY", dueAt: new Date(now.getTime() + 3 * day) },
        { type: "FEEDBACK", dueAt: new Date(now.getTime() + 2 * day) },
        { type: "SERVICE_REMINDER", dueAt: new Date(now.getTime() + reminderDays * day) },
      ].map((f) => ({ ...f, branchId: job.branchId, customerId: job.customerId, serviceJobId: jobId, assignedToId: j.serviceAdvisorId })),
    });
    await queueCustomerMessage(tx, { templateKey: "VEHICLE_DELIVERED", businessUnitId: job.branch.businessUnitId, values: templateValues(j, { delivered_at: now.toISOString().slice(0, 10) }), email: job.customer.email, customerId: job.customerId, branchId: job.branchId, serviceJobId: jobId });
    await activity(tx, job.branchId, jobId, actor.userId, "job.delivered", { recipient: input.recipientName });
    await audit(tx, { actorId: actor.userId, action: "service.job.handover", entityType: "ServiceJob", entityId: jobId, branchId: job.branchId, after: { recipient: input.recipientName, odometerOut: input.odometerOut } });
  });
  afterCommit(jobId);
}

export const followUpInput = z.object({
  status: z.enum(["COMPLETED", "NO_ANSWER", "RESCHEDULED", "CANCELLED"]),
  outcome: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
  nextDueAt: z.coerce.date().optional(),
});

export async function recordFollowUp(actor: Actor, id: string, input: z.infer<typeof followUpInput>) {
  requirePermission(actor, "followups.manage");
  const f = await prisma.followUp.findUnique({ where: { id } });
  if (!f) throw notFound("Follow-up");
  assertBranch(actor, f.branchId, "Follow-up");
  if (f.status !== "PENDING") throw rule("This follow-up is already closed.");
  if ((input.status === "RESCHEDULED" || input.status === "NO_ANSWER") && !input.nextDueAt) throw invalid("Choose the next follow-up date.");
  await prisma.$transaction(async (tx) => {
    await tx.followUp.update({
      where: { id },
      data: { status: input.status === "NO_ANSWER" || input.status === "RESCHEDULED" ? "PENDING" : input.status, attempts: { increment: 1 }, outcome: input.outcome ?? input.status, notes: input.notes, nextDueAt: input.nextDueAt ?? null, dueAt: input.nextDueAt ?? f.dueAt, completedAt: input.status === "COMPLETED" ? new Date() : null },
    });
    await audit(tx, { actorId: actor.userId, action: "followup.record", entityType: "FollowUp", entityId: id, branchId: f.branchId, after: input });
  });
}

export async function listFollowUps(actor: Actor, q: { branchId?: string; due?: "today" | "overdue" | "upcoming" }) {
  requirePermission(actor, "followups.manage", "service.view");
  const now = new Date();
  const endOfDay = new Date(now.getTime() + 24 * 3600_000);
  return prisma.followUp.findMany({
    where: {
      ...branchFilter(actor, q.branchId),
      status: "PENDING",
      dueAt: q.due === "overdue" ? { lt: now } : q.due === "upcoming" ? { gt: endOfDay } : { lte: endOfDay },
    },
    orderBy: { dueAt: "asc" },
    take: 200,
    include: { customer: { select: { fullName: true, phone: true } }, serviceJob: { select: { id: true, jobNumber: true } }, assignedTo: { select: { name: true } } },
  });
}

export const feedbackInput = z.object({ rating: z.coerce.number().int().min(1).max(5), comments: z.string().trim().max(2000).optional() });

export async function submitFeedback(actor: Actor, jobId: string, input: z.infer<typeof feedbackInput>) {
  if (actor.kind !== "CUSTOMER") throw forbidden();
  const job = await getJobForActor(actor, jobId);
  if (!["DELIVERED", "CLOSED"].includes(job.status)) throw rule("Feedback opens after your vehicle is delivered.");
  const exists = await prisma.customerFeedback.findUnique({ where: { serviceJobId: jobId } });
  if (exists) throw rule("Thank you — feedback for this visit was already submitted.");
  await prisma.$transaction(async (tx) => {
    await tx.customerFeedback.create({ data: { serviceJobId: jobId, customerId: job.customerId, rating: input.rating, comments: input.comments } });
    await tx.followUp.updateMany({ where: { serviceJobId: jobId, type: "FEEDBACK", status: "PENDING" }, data: { status: "COMPLETED", outcome: `Rated ${input.rating}/5 in portal`, completedAt: new Date() } });
    if (input.rating <= 2) await notifyUsers(tx, [job.serviceAdvisorId], { type: "LOW_FEEDBACK", title: `Low rating (${input.rating}/5) — ${job.jobNumber}`, body: input.comments ?? "", link: `/service/${jobId}`, branchId: job.branchId });
  });
}

/**
 * The customer's view of a job. An explicit allow-list: no internal notes, costs,
 * supplier data, or other employees' private details are ever selected.
 */
/** Customer wording for a repair's state. Internal pause/block reasons are never shown. */
function repairStateForCustomer(status: string, holdReason: string | null) {
  switch (status) {
    case "PENDING": return { key: "scheduled", label: "Scheduled" };
    case "READY": return { key: "next", label: "Next in line" };
    case "IN_PROGRESS": return { key: "working", label: "Being worked on now" };
    case "PAUSED": return { key: "paused", label: "Paused — will resume shortly" };
    case "BLOCKED": return holdReason?.startsWith("Awaiting spare part") ? { key: "parts", label: "Waiting for a part" } : { key: "hold", label: "On hold — your advisor will update you" };
    case "COMPLETED": return { key: "done", label: "Done" };
    default: return { key: "other", label: status.toLowerCase() };
  }
}

function partStateForCustomer(req: { status: string; expectedAvailableAt: Date | null } | undefined) {
  if (!req) return { key: "checking", label: "Being checked in stores", expected: null };
  switch (req.status) {
    case "RESERVED": case "PICKING": case "PICKED": return { key: "reserved", label: "In stock — set aside for your vehicle", expected: null };
    case "ISSUED": return { key: "issued", label: "Handed to the technician", expected: null };
    case "UNAVAILABLE": case "AWAITING_PROCUREMENT":
      if (!req.expectedAvailableAt) return { key: "ordering", label: "Out of stock — being ordered, date to be confirmed", expected: null };
      if (req.expectedAvailableAt.getTime() < Date.now()) return { key: "late", label: "Delayed — later than expected, being chased", expected: req.expectedAvailableAt };
      return { key: "ordered", label: "On order", expected: req.expectedAvailableAt };
    default: return { key: "other", label: "—", expected: null };
  }
}

const firstName = (n: string | null | undefined) => (n ? n.split(" ")[0] : null);

/**
 * The customer's view of a job. An explicit allow-list: no internal notes, internal hold reasons,
 * purchase costs, supplier data, or other employees' private details are ever selected.
 * Organised around three questions: what is being changed, what is needed, how long it takes.
 */
export async function customerJobView(actor: Actor, jobId: string) {
  await getJobForActor(actor, jobId); // authorise before touching anything
  await refreshEtaIfStale(jobId);
  const job = await getJobForActor(actor, jobId);
  const [events, estimates, invoice, photos, feedback, tasks, requests, inspection, qcList] = await Promise.all([
    prisma.serviceTimelineEvent.findMany({ where: { jobId }, orderBy: { occurredAt: "asc" } }),
    prisma.repairEstimate.findMany({
      where: { jobId, status: { not: "DRAFT" } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, estimateNumber: true, kind: true, status: true, labourTotal: true, partsTotal: true, discountTotal: true, taxTotal: true, grandTotal: true, approvedTotal: true, expectedCompletionAt: true, customerNote: true, sentAt: true, decidedAt: true,
        lines: { select: { id: true, type: true, description: true, quantity: true, unitPrice: true, discount: true, taxAmount: true, lineTotal: true, isOptional: true, approvalStatus: true, repairTaskId: true } },
      },
    }),
    prisma.invoice.findFirst({ where: { serviceJobId: jobId, status: { notIn: ["DRAFT", "CANCELLED"] } }, select: { id: true, invoiceNumber: true, status: true, grandTotal: true, amountPaid: true, balanceDue: true } }),
    prisma.servicePhoto.findMany({ where: { jobId, customerVisible: true }, select: { id: true, fileId: true, stage: true, caption: true } }),
    prisma.customerFeedback.findUnique({ where: { serviceJobId: jobId }, select: { rating: true, comments: true } }),
    prisma.repairTask.findMany({
      where: { jobId },
      orderBy: { sequence: "asc" },
      select: {
        id: true, title: true, description: true, status: true, origin: true, requiresApproval: true, approved: true, isOptional: true, isSafetyCritical: true,
        estimatedMinMinutes: true, estimatedMaxMinutes: true, workedMinutes: true, lastResumedAt: true, startedAt: true, completedAt: true, holdReason: true, reworkCount: true,
        assignedMechanic: { select: { name: true } },
      },
    }),
    prisma.sparePartRequest.findMany({ where: { jobId, status: { not: "CANCELLED" } }, select: { estimateLineId: true, status: true, expectedAvailableAt: true } }),
    prisma.serviceInspection.findFirst({ where: { jobId, completedAt: { not: null } }, orderBy: { completedAt: "desc" }, select: { checklist: true, customerSummary: true, completedAt: true, safetyCritical: true, examiner: { select: { name: true } } } }),
    prisma.qualityInspection.findMany({ where: { jobId, completedAt: { not: null } }, orderBy: { completedAt: "asc" }, select: { result: true, completedAt: true, testRides: { select: { result: true, endedAt: true } } } }),
  ]);
  const now = Date.now();
  const tz = job.branch.timezone;
  const breakdown = (job.etaBreakdown ?? {}) as { reason?: string; activeMinutes?: { min: number; max: number }; queueMinutes?: { min: number; max: number }; partsWaitMinutes?: number };
  const reqByLine = new Map(requests.filter((r) => r.estimateLineId).map((r) => [r.estimateLineId!, r]));
  const allLines = estimates.flatMap((e) => e.lines.map((l) => ({ ...l, estimateStatus: e.status, decidedAt: e.decidedAt })));

  // What is being changed: every repair the customer agreed to (or that needs no approval).
  const repairs = tasks
    .filter((t) => t.status !== "CANCELLED" && (t.approved || !t.requiresApproval))
    .map((t) => {
      const lines = allLines.filter((l) => l.repairTaskId === t.id && l.approvalStatus === "APPROVED");
      const running = t.status === "IN_PROGRESS" && t.lastResumedAt ? Math.round((now - t.lastResumedAt.getTime()) / 60_000) : 0;
      return {
        id: t.id,
        title: t.title,
        why: t.description,
        safety: t.isSafetyCritical,
        addedLater: t.origin === "SUPPLEMENTARY",
        redoneAfterCheck: t.reworkCount > 0,
        state: repairStateForCustomer(t.status, t.holdReason),
        technician: firstName(t.assignedMechanic?.name),
        time: { estimateMin: t.estimatedMinMinutes, estimateMax: t.estimatedMaxMinutes, spent: t.workedMinutes + running, startedAt: t.startedAt, finishedAt: t.completedAt },
        parts: lines.filter((l) => l.type === "PART").map((l) => ({ name: l.description.replace(/\s*\([^)]*\)\s*$/, ""), quantity: l.quantity, ...partStateForCustomer(reqByLine.get(l.id)) })),
        price: lines.reduce((a, l) => a + Number(l.lineTotal), 0),
      };
    });
  const declined = tasks.filter((t) => t.status === "CANCELLED" && t.requiresApproval && !t.approved).map((t) => ({ id: t.id, title: t.title }));
  // Repairs proposed but not yet decided: explanation and time, shown next to the approval buttons.
  const proposed = Object.fromEntries(
    tasks.filter((t) => t.status !== "CANCELLED" && t.requiresApproval && !t.approved).map((t) => [t.id, { why: t.description, safety: t.isSafetyCritical, min: t.estimatedMinMinutes, max: t.estimatedMaxMinutes }]),
  );

  // What is needed from the customer.
  const pendingEstimate = estimates.find((e) => e.status === "SENT");
  const closed = ["DELIVERED", "CLOSED", "CANCELLED"].includes(job.status);
  const needsYou: { key: string; title: string; detail: string }[] = [];
  if (pendingEstimate) needsYou.push({ key: "approve", title: pendingEstimate.kind === "SUPPLEMENTARY" ? "Approve or decline the additional work" : "Approve or decline the estimate", detail: "Chargeable work starts only after you decide. Choose for each repair below." });
  if (!job.customerAcknowledgedAt && !closed) needsYou.push({ key: "acknowledge", title: "Confirm the job card", detail: "Check the vehicle details, odometer and the problems we noted at reception." });
  if (job.status === "READY_FOR_DELIVERY") needsYou.push({ key: "collect", title: "Collect your vehicle", detail: invoice && Number(invoice.balanceDue) > 0 ? `Balance of ₹${Number(invoice.balanceDue).toFixed(2)} is payable at pickup.` : `Your vehicle is ready at ${job.branch.name}.` });
  if (closed && job.status !== "CANCELLED" && !feedback) needsYou.push({ key: "feedback", title: "Tell us how we did", detail: "Takes ten seconds and goes straight to the branch." });

  // What the workshop is waiting for.
  const waitingOn: { title: string; detail: string; expected: Date | null; late: boolean }[] = [];
  for (const r of repairs) for (const p of r.parts) if (p.key === "ordering" || p.key === "ordered" || p.key === "late") waitingOn.push({ title: `${p.name} for “${r.title}”`, detail: p.label, expected: p.expected, late: p.key === "late" });

  // How long it takes: progress, time left, and every change to the promised time with the reason.
  const done = repairs.filter((r) => r.state.key === "done").length;
  const etaChanges: { at: Date; from: Date | null; to: Date | null; why: string }[] = [];
  let lastEta: Date | null = null;
  let seen = false;
  for (const e of events) {
    const eta = e.etaLatest;
    if (!seen) { lastEta = eta; seen = true; continue; }
    const moved = (eta?.getTime() ?? null) !== (lastEta?.getTime() ?? null) && (!eta || !lastEta || Math.abs(eta.getTime() - lastEta.getTime()) > 30 * 60_000);
    if (moved) etaChanges.push({ at: e.occurredAt, from: lastEta, to: eta, why: e.title });
    lastEta = eta;
  }
  const afterRepairs = [
    { label: "Quality check", done: qcList.some((q) => q.result === "PASSED") },
    { label: "Test ride", done: qcList.some((q) => q.testRides.some((t) => t.result === "OK" && t.endedAt)) },
    { label: "Final bill", done: !!invoice },
  ];

  return {
    id: job.id,
    jobNumber: job.jobNumber,
    status: job.status,
    serviceType: job.serviceType,
    receivedAt: job.receivedAt,
    acknowledgedAt: job.customerAcknowledgedAt,
    vehicle: { modelName: job.customerVehicle.modelName, registrationNumber: job.customerVehicle.registrationNumber, odometerIn: job.odometerIn, fuelLevel: job.fuelLevel },
    branch: { name: job.branch.name, phone: job.branch.phone, address: [job.branch.addressLine, job.branch.city].filter(Boolean).join(", "), timezone: tz },
    advisor: { name: job.serviceAdvisor.name, phone: job.branch.phone },
    reportedProblems: job.reportedProblems,
    existingDamage: job.existingDamage,
    accessoriesReceived: job.accessoriesReceived,
    eta: {
      earliest: job.etaEarliest,
      latest: job.etaLatest,
      confidence: job.etaConfidence,
      updatedAt: job.etaUpdatedAt,
      reason: breakdown.reason ?? null,
      initialEstimate: job.expectedCompletionAt,
    },
    time: {
      repairsDone: done,
      repairsTotal: repairs.length,
      workLeft: breakdown.activeMinutes ?? null,
      partsWait: breakdown.partsWaitMinutes ?? 0,
      queue: breakdown.queueMinutes ?? null,
      afterRepairs,
      changes: etaChanges,
    },
    partsDelayed: waitingOn.length > 0,
    needsYou,
    waitingOn,
    found: inspection
      ? {
          summary: inspection.customerSummary,
          safety: inspection.safetyCritical,
          at: inspection.completedAt,
          by: firstName(inspection.examiner.name),
          checks: ((inspection.checklist ?? []) as { label: string; result: string }[]).map((c) => ({ label: c.label, result: c.result })),
        }
      : null,
    repairs,
    declined,
    proposed,
    costs: {
      approved: estimates.reduce((a, e) => a + Number(e.approvedTotal), 0),
      awaitingDecision: pendingEstimate ? Number(pendingEstimate.grandTotal) : 0,
    },
    stages: buildStageView(events, job.status),
    events: events.map((e) => ({ id: e.id, stage: e.stage, state: e.state, title: e.title, note: e.customerNote, actorName: firstName(e.actorName), actorRole: e.actorRole, next: e.nextExpectedAction, at: e.occurredAt })),
    estimates,
    tasks: repairs.map((r) => ({ id: r.id, title: r.title, status: r.state.key })),
    invoice,
    photos,
    feedback,
  };
}

export type CustomerJobView = Awaited<ReturnType<typeof customerJobView>>;

/** Staff workspace data for a job (everything, including internal records). */
export async function staffJobDetail(actor: Actor, jobId: string) {
  await getJobForActor(actor, jobId);
  await refreshEtaIfStale(jobId);
  const job = await getJobForActor(actor, jobId);
  if (actor.kind !== "STAFF") throw forbidden();
  const [full, events, activityLog, availability] = await Promise.all([
    prisma.serviceJob.findUniqueOrThrow({
      where: { id: jobId },
      include: {
        assignments: { where: { releasedAt: null }, include: { user: { select: { id: true, name: true, employee: { select: { employeeCode: true } } } } } },
        inspections: { include: { examiner: { select: { name: true } } }, orderBy: { startedAt: "asc" } },
        tasks: {
          orderBy: { sequence: "asc" },
          include: {
            assignedMechanic: { select: { id: true, name: true, employee: { select: { employeeCode: true } } } },
            dependencies: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
            workLogs: { orderBy: { createdAt: "desc" }, take: 10, include: { mechanic: { select: { name: true } } } },
          },
        },
        estimates: { orderBy: { createdAt: "asc" }, include: { lines: true, approvals: { orderBy: { decidedAt: "asc" } } } },
        partRequests: {
          orderBy: { createdAt: "asc" },
          include: { item: { select: { partNumber: true, name: true } }, location: { select: { code: true } }, issue: { include: { issuedBy: { select: { name: true } }, receivedBy: { select: { name: true } } } }, repairTask: { select: { title: true } } },
        },
        qualityInspections: { orderBy: { startedAt: "asc" }, include: { inspector: { select: { name: true } }, testRides: { include: { rider: { select: { name: true } } } } } },
        invoices: { include: { lines: true, payments: { orderBy: { createdAt: "asc" } }, creditNotes: true }, orderBy: { createdAt: "asc" } },
        photos: { orderBy: { createdAt: "asc" } },
        handover: true,
        feedback: true,
        followUps: { orderBy: { dueAt: "asc" } },
      },
    }),
    prisma.serviceTimelineEvent.findMany({ where: { jobId }, orderBy: { occurredAt: "asc" } }),
    prisma.internalActivityLog.findMany({ where: { jobId }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.inventoryBalance.findMany({
      where: { branchId: job.branchId, item: { estimateLines: { some: { estimate: { jobId } } } } },
      select: { itemId: true, quantityOnHand: true, quantityReserved: true },
    }),
  ]);
  const actorIds = [...new Set(activityLog.map((a) => a.actorId).filter((x): x is string => !!x))];
  const actors = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  const names = new Map(actors.map((a) => [a.id, a.name]));
  const stock = new Map<string, { onHand: number; reserved: number }>();
  for (const b of availability) {
    const s = stock.get(b.itemId) ?? { onHand: 0, reserved: 0 };
    s.onHand += b.quantityOnHand;
    s.reserved += b.quantityReserved;
    stock.set(b.itemId, s);
  }
  return {
    job,
    full,
    events,
    stages: buildStageView(events, job.status),
    activity: activityLog.map((a) => ({ ...a, actorName: a.actorId ? names.get(a.actorId) ?? "—" : "System" })),
    stock: Object.fromEntries(stock),
  };
}

export type StaffJobDetail = Awaited<ReturnType<typeof staffJobDetail>>;

export const photoMetaInput = z.object({ stage: z.enum(["INTAKE", "INSPECTION", "REPAIR", "QUALITY"]), caption: z.string().trim().max(200).optional(), customerVisible: z.boolean().default(false) });

export async function attachJobPhoto(actor: Actor, jobId: string, fileId: string, meta: z.infer<typeof photoMetaInput>) {
  const job = await getJobForActor(actor, jobId);
  const file = await prisma.fileObject.findUnique({ where: { id: fileId } });
  if (!file || file.branchId !== job.branchId) throw notFound("File");
  return prisma.servicePhoto.create({ data: { jobId, fileId, stage: meta.stage, caption: meta.caption, customerVisible: meta.customerVisible, uploadedById: actor.userId } });
}

export type { Prisma };
