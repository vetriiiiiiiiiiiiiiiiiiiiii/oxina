import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { conflict, forbidden, invalid, notFound, rule } from "@/lib/errors";
import { assertBranch, branchFilter, can, requirePermission, type Actor } from "@/lib/rbac/actor";
import { audit } from "@/lib/audit";
import { nextNumber } from "@/lib/numbering";
import { D, ZERO, calcLine, round2, sum } from "@/lib/money";
import { notifyUsers } from "@/lib/notifications";
import { getBranchSetting } from "./settings";
import { afterCommit, getJobForActor, lockJob, timeline } from "./service/common";
import { qualityGatePassed } from "./service/quality";

type DraftLine = Omit<Prisma.InvoiceLineItemCreateManyInput, "invoiceId">;

export async function writeInvoiceTotals(tx: Tx, invoiceId: string, intraState: boolean) {
  const lines = await tx.invoiceLineItem.findMany({ where: { invoiceId } });
  const subtotal = sum(lines.map((l) => D(l.unitPrice).times(l.quantity)));
  const discount = sum(lines.map((l) => l.discount));
  const tax = sum(lines.map((l) => l.taxAmount));
  const grand = sum(lines.map((l) => l.lineTotal));
  const half = round2(tax.dividedBy(2));
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      subtotal: round2(subtotal),
      discountTotal: round2(discount),
      taxTotal: round2(tax),
      cgstTotal: intraState ? half : ZERO,
      sgstTotal: intraState ? round2(tax.minus(half)) : ZERO,
      igstTotal: intraState ? ZERO : round2(tax),
      grandTotal: round2(grand),
      balanceDue: round2(grand),
    },
  });
}

/** Stage 8 — draft the final invoice from approved labour and parts actually issued. */
export async function buildServiceInvoice(actor: Actor, jobId: string) {
  requirePermission(actor, "billing.manage");
  const job = await getJobForActor(actor, jobId);
  const invoice = await prisma.$transaction(async (tx) => {
    const j = await lockJob(tx, jobId);
    if (j.status !== "FINAL_BILLING") throw rule("The final invoice is prepared after the quality inspection passes.");
    if (!(await qualityGatePassed(tx, jobId))) throw rule("Mandatory quality checks have not passed.");
    const existing = await tx.invoice.findFirst({ where: { serviceJobId: jobId, status: { not: "CANCELLED" } } });
    if (existing && existing.status !== "DRAFT") throw rule("The invoice is already finalized. Use a credit note for corrections.");

    const labourSac = String(await getBranchSetting(tx, job.branchId, "billing.labourSac"));
    const lines: DraftLine[] = [];
    const estLines = await tx.estimateLineItem.findMany({
      where: { estimate: { jobId }, approvalStatus: "APPROVED", type: { in: ["LABOUR", "OTHER"] } },
      include: { repairTask: true },
    });
    for (const l of estLines) {
      if (l.type === "LABOUR" && l.repairTask && l.repairTask.status !== "COMPLETED") continue; // only work actually done
      lines.push({ type: l.type, description: l.description, hsnSac: l.type === "LABOUR" ? labourSac : null, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, taxRatePercent: l.taxRatePercent, taxAmount: l.taxAmount, lineTotal: l.lineTotal, sourceType: "ESTIMATE_LINE", sourceId: l.id });
    }
    const issues = await tx.sparePartIssue.findMany({ where: { request: { jobId } }, include: { item: true, request: { include: { estimateLine: true } } } });
    for (const i of issues) {
      const est = i.request.estimateLine;
      const discount = est && est.quantity > 0 ? round2(D(est.discount).times(i.quantity).dividedBy(est.quantity)) : ZERO;
      const c = calcLine({ quantity: i.quantity, unitPrice: i.unitPrice, discount, taxRatePercent: i.item.taxRatePercent });
      lines.push({ type: "PART", description: `${i.item.name} (${i.item.partNumber})`, inventoryItemId: i.itemId, hsnSac: i.item.hsnCode, quantity: i.quantity, unitPrice: i.unitPrice, discount: c.discount, taxRatePercent: i.item.taxRatePercent, taxAmount: c.tax, lineTotal: c.total, sourceType: "PART_ISSUE", sourceId: i.id });
    }

    const placeOfSupply = job.customer.stateCode ?? job.branch.stateCode ?? null;
    const intra = !placeOfSupply || placeOfSupply === job.branch.stateCode;
    let inv = existing;
    if (inv) await tx.invoiceLineItem.deleteMany({ where: { invoiceId: inv.id } });
    else inv = await tx.invoice.create({ data: { branchId: job.branchId, kind: "SERVICE", serviceJobId: jobId, customerId: job.customerId, placeOfSupply, createdById: actor.userId } });
    if (lines.length) await tx.invoiceLineItem.createMany({ data: lines.map((l) => ({ ...l, invoiceId: inv!.id })) });
    await writeInvoiceTotals(tx, inv.id, intra);
    await audit(tx, { actorId: actor.userId, action: "invoice.draft", entityType: "Invoice", entityId: inv.id, branchId: job.branchId, after: { lines: lines.length } });
    return inv;
  });
  afterCommit(jobId);
  return invoice;
}

export async function getInvoiceForActor(actor: Actor, invoiceId: string) {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      lines: true,
      payments: { orderBy: { createdAt: "asc" } },
      creditNotes: true,
      customer: true,
      branch: true,
      serviceJob: { select: { id: true, jobNumber: true, customerVehicle: { select: { registrationNumber: true, modelName: true } } } },
      booking: { select: { id: true, bookingNumber: true } },
    },
  });
  if (!inv) throw notFound("Invoice");
  if (actor.kind === "CUSTOMER") {
    if (inv.customerId !== actor.customerId || inv.status === "DRAFT") throw notFound("Invoice");
    return inv;
  }
  requirePermission(actor, "billing.view", "billing.manage");
  assertBranch(actor, inv.branchId, "Invoice");
  return inv;
}

export async function finalizeInvoice(actor: Actor, invoiceId: string) {
  requirePermission(actor, "billing.manage");
  const inv = await getInvoiceForActor(actor, invoiceId);
  if (inv.status !== "DRAFT") throw rule("This invoice is already finalized.");
  if (inv.kind === "VEHICLE_SALE" && !can(actor, "showroom.pricing.approve")) throw forbidden("Finalizing a vehicle sale requires pricing approval rights.");
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Invoice" WHERE "id" = ${invoiceId}::uuid FOR UPDATE`;
    const fresh = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { branch: { include: { businessUnit: true } }, _count: { select: { lines: true } } } });
    if (fresh.status !== "DRAFT") throw conflict("This invoice was finalized by someone else.");
    if (!fresh._count.lines) throw rule("An invoice needs at least one line.");
    if (fresh.serviceJobId && !(await qualityGatePassed(tx, fresh.serviceJobId))) throw rule("Mandatory quality checks have not passed.");
    const number = await nextNumber(tx, "INV", fresh.branch.businessUnit.code);
    const paid = D(fresh.grandTotal).isZero();
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { invoiceNumber: number, status: paid ? "PAID" : "FINALIZED", finalizedAt: new Date(), finalizedById: actor.userId, balanceDue: fresh.grandTotal },
    });
    if (fresh.serviceJobId) {
      await timeline(tx, fresh.serviceJobId, { stage: "FINAL_BILLING", state: "COMPLETED", title: "Final invoice issued", actor });
      const cust = await tx.customer.findUniqueOrThrow({ where: { id: fresh.customerId } });
      if (cust.userId) await notifyUsers(tx, [cust.userId], { type: "INVOICE_GENERATED", title: `Invoice ${number} issued`, body: "Your final invoice is available.", link: `/portal/invoices/${invoiceId}` });
    }
    await audit(tx, { actorId: actor.userId, action: "invoice.finalize", entityType: "Invoice", entityId: invoiceId, branchId: fresh.branchId, after: { invoiceNumber: number, grandTotal: fresh.grandTotal } });
  });
  if (inv.serviceJobId) afterCommit(inv.serviceJobId);
}

export const paymentInput = z.object({
  invoiceId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
  amount: z.coerce.number().positive().max(100_000_000),
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER", "CHEQUE", "FINANCE"]),
  reference: z
    .string()
    .trim()
    .max(80)
    .optional()
    // Guard against card numbers being pasted into the reference field.
    .refine((r) => !r || !/\b\d{13,19}\b/.test(r.replace(/[\s-]/g, "")), "Do not enter card numbers. Use the terminal's transaction reference."),
  notes: z.string().trim().max(500).optional(),
  confirmNow: z.boolean().default(false),
});

export async function recordPayment(actor: Actor, input: z.infer<typeof paymentInput>) {
  requirePermission(actor, "payments.record");
  if (!!input.invoiceId === !!input.bookingId) throw invalid("Record a payment against either an invoice or a booking.");
  if (input.confirmNow) requirePermission(actor, "payments.confirm");
  const payment = await prisma.$transaction(async (tx) => {
    let branchId: string;
    let customerId: string;
    if (input.invoiceId) {
      await tx.$queryRaw`SELECT 1 FROM "Invoice" WHERE "id" = ${input.invoiceId}::uuid FOR UPDATE`;
      const inv = await tx.invoice.findUnique({ where: { id: input.invoiceId } });
      if (!inv) throw notFound("Invoice");
      assertBranch(actor, inv.branchId, "Invoice");
      if (!["FINALIZED", "PARTIALLY_PAID"].includes(inv.status)) throw rule("Payments can only be recorded against a finalized, unpaid invoice.");
      const pending = await tx.payment.aggregate({ where: { invoiceId: inv.id, status: "PENDING_CONFIRMATION" }, _sum: { amount: true } });
      const open = D(inv.balanceDue).minus(D(pending._sum.amount));
      if (D(input.amount).greaterThan(open)) throw invalid(`Amount exceeds the outstanding balance (${open.toFixed(2)}).`);
      const partialOk = await getBranchSetting(tx, inv.branchId, "billing.allowPartialPayments");
      if (!partialOk && !D(input.amount).equals(open)) throw invalid("Partial payments are not enabled for this branch.");
      branchId = inv.branchId;
      customerId = inv.customerId;
    } else {
      const b = await tx.vehicleBooking.findUnique({ where: { id: input.bookingId } });
      if (!b) throw notFound("Booking");
      assertBranch(actor, b.branchId, "Booking");
      if (b.status === "CANCELLED") throw rule("Booking is cancelled.");
      branchId = b.branchId;
      customerId = b.customerId;
    }
    const p = await tx.payment.create({
      data: { branchId, customerId, invoiceId: input.invoiceId ?? null, bookingId: input.bookingId ?? null, amount: input.amount, method: input.method, reference: input.reference ?? null, notes: input.notes ?? null, recordedById: actor.userId },
    });
    await audit(tx, { actorId: actor.userId, action: "payment.record", entityType: "Payment", entityId: p.id, branchId, after: { amount: input.amount, method: input.method } });
    return p;
  });
  if (input.confirmNow) await confirmPayment(actor, payment.id);
  return payment;
}

/** Only confirmed payments reduce the balance. Receipt numbers are issued on confirmation. */
export async function confirmPayment(actor: Actor, paymentId: string) {
  requirePermission(actor, "payments.confirm");
  const res = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Payment" WHERE "id" = ${paymentId}::uuid FOR UPDATE`;
    const p = await tx.payment.findUnique({ where: { id: paymentId }, include: { branch: { include: { businessUnit: true } } } });
    if (!p) throw notFound("Payment");
    assertBranch(actor, p.branchId, "Payment");
    if (p.status !== "PENDING_CONFIRMATION") throw rule("This payment is not awaiting confirmation.");
    const receiptNumber = await nextNumber(tx, "RCPT", p.branch.businessUnit.code);
    await tx.payment.update({ where: { id: paymentId }, data: { status: "CONFIRMED", confirmedById: actor.userId, confirmedAt: new Date(), receiptNumber } });
    let jobId: string | null = null;
    if (p.invoiceId) {
      await tx.$queryRaw`SELECT 1 FROM "Invoice" WHERE "id" = ${p.invoiceId}::uuid FOR UPDATE`;
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: p.invoiceId } });
      const paid = D(inv.amountPaid).plus(p.amount);
      const balance = D(inv.grandTotal).minus(paid).minus(inv.creditedAmount);
      if (balance.isNegative()) throw rule("Confirming this payment would overpay the invoice.");
      await tx.invoice.update({ where: { id: inv.id }, data: { amountPaid: paid, balanceDue: balance, status: balance.isZero() ? "PAID" : "PARTIALLY_PAID" } });
      jobId = inv.serviceJobId;
      const cust = await tx.customer.findUniqueOrThrow({ where: { id: p.customerId } });
      if (cust.userId) await notifyUsers(tx, [cust.userId], { type: "PAYMENT_CONFIRMED", title: `Payment received — ${receiptNumber}`, body: `Thank you. Balance due: ₹${balance.toFixed(2)}.`, link: `/portal/invoices/${inv.id}` });
    }
    await audit(tx, { actorId: actor.userId, action: "payment.confirm", entityType: "Payment", entityId: p.id, branchId: p.branchId, after: { receiptNumber } });
    return { jobId, receiptNumber };
  });
  if (res.jobId) afterCommit(res.jobId);
  return res;
}

export async function rejectPayment(actor: Actor, paymentId: string, reason: string) {
  requirePermission(actor, "payments.confirm");
  const p = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw notFound("Payment");
  assertBranch(actor, p.branchId, "Payment");
  if (p.status !== "PENDING_CONFIRMATION") throw rule("Only pending payments can be marked failed.");
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: paymentId }, data: { status: "FAILED", notes: [p.notes, `Failed: ${reason}`].filter(Boolean).join(" | ") } });
    await audit(tx, { actorId: actor.userId, action: "payment.fail", entityType: "Payment", entityId: p.id, branchId: p.branchId, after: { reason } });
  });
}

export const creditNoteInput = z.object({ amount: z.coerce.number().positive(), reason: z.string().trim().min(5).max(500) });

export async function issueCreditNote(actor: Actor, invoiceId: string, input: z.infer<typeof creditNoteInput>) {
  requirePermission(actor, "billing.credit_note");
  const inv = await getInvoiceForActor(actor, invoiceId);
  if (!["FINALIZED", "PARTIALLY_PAID", "PAID"].includes(inv.status)) throw rule("Credit notes apply to finalized invoices.");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Invoice" WHERE "id" = ${invoiceId}::uuid FOR UPDATE`;
    const fresh = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { branch: { include: { businessUnit: true } } } });
    const credited = D(fresh.creditedAmount).plus(input.amount);
    if (credited.greaterThan(fresh.grandTotal)) throw invalid("Total credit cannot exceed the invoice value.");
    const balance = D(fresh.grandTotal).minus(fresh.amountPaid).minus(credited);
    const cn = await tx.creditNote.create({
      data: { creditNoteNumber: await nextNumber(tx, "CN", fresh.branch.businessUnit.code), invoiceId, amount: input.amount, reason: input.reason, issuedById: actor.userId },
    });
    // Over-credit against an already-paid invoice becomes a refund to process, not a negative balance.
    await tx.invoice.update({ where: { id: invoiceId }, data: { creditedAmount: credited, balanceDue: balance.isNegative() ? ZERO : balance, status: balance.lessThanOrEqualTo(0) ? "PAID" : fresh.status } });
    await audit(tx, { actorId: actor.userId, action: "invoice.credit_note", entityType: "CreditNote", entityId: cn.id, branchId: fresh.branchId, after: { amount: input.amount, reason: input.reason, refundDue: balance.isNegative() ? balance.abs().toFixed(2) : "0" } });
    return cn;
  });
}

export async function cancelInvoice(actor: Actor, invoiceId: string, reason: string) {
  requirePermission(actor, "billing.credit_note");
  const inv = await getInvoiceForActor(actor, invoiceId);
  if (inv.status === "CANCELLED") throw rule("Already cancelled.");
  if (inv.payments.some((p) => p.status === "CONFIRMED")) throw rule("Invoices with confirmed payments must be corrected with a credit note.");
  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason } });
    await tx.payment.updateMany({ where: { invoiceId, status: "PENDING_CONFIRMATION" }, data: { status: "FAILED" } });
    await audit(tx, { actorId: actor.userId, action: "invoice.cancel", entityType: "Invoice", entityId: invoiceId, branchId: inv.branchId, after: { reason } });
  });
}

export const refundInput = z.object({ amount: z.coerce.number().positive(), reason: z.string().trim().min(5).max(500) });

export async function requestRefund(actor: Actor, paymentId: string, input: z.infer<typeof refundInput>) {
  requirePermission(actor, "billing.credit_note", "refunds.approve");
  const p = await prisma.payment.findUnique({ where: { id: paymentId }, include: { refunds: true } });
  if (!p) throw notFound("Payment");
  assertBranch(actor, p.branchId, "Payment");
  if (p.status !== "CONFIRMED") throw rule("Only confirmed payments can be refunded.");
  const already = sum(p.refunds.filter((r) => r.status !== "REJECTED").map((r) => r.amount));
  if (already.plus(input.amount).greaterThan(p.amount)) throw invalid("Refunds cannot exceed the payment amount.");
  return prisma.$transaction(async (tx) => {
    const r = await tx.refund.create({ data: { paymentId, amount: input.amount, reason: input.reason, requestedById: actor.userId } });
    await audit(tx, { actorId: actor.userId, action: "refund.request", entityType: "Refund", entityId: r.id, branchId: p.branchId, after: input });
    return r;
  });
}

export async function decideRefund(actor: Actor, refundId: string, approve: boolean) {
  requirePermission(actor, "refunds.approve");
  const r = await prisma.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
  if (!r) throw notFound("Refund");
  assertBranch(actor, r.payment.branchId, "Refund");
  if (r.status !== "REQUESTED") throw rule("Refund already decided.");
  if (r.requestedById === actor.userId) throw forbidden("Refunds must be approved by someone other than the requester.");
  await prisma.$transaction(async (tx) => {
    await tx.refund.update({ where: { id: refundId }, data: { status: approve ? "APPROVED" : "REJECTED", approvedById: actor.userId } });
    await audit(tx, { actorId: actor.userId, action: approve ? "refund.approve" : "refund.reject", entityType: "Refund", entityId: refundId, branchId: r.payment.branchId });
  });
}

export const invoiceQuery = z.object({
  branchId: z.string().uuid().optional(),
  status: z.enum(["DRAFT", "FINALIZED", "PARTIALLY_PAID", "PAID", "CANCELLED", "OUTSTANDING"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export async function listInvoices(actor: Actor, q: z.infer<typeof invoiceQuery>) {
  requirePermission(actor, "billing.view", "billing.manage");
  const where: Prisma.InvoiceWhereInput = { ...branchFilter(actor, q.branchId) };
  if (q.status === "OUTSTANDING") where.status = { in: ["FINALIZED", "PARTIALLY_PAID"] };
  else if (q.status) where.status = q.status;
  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * 25,
      take: 25,
      include: { customer: { select: { fullName: true } }, branch: { select: { name: true } }, serviceJob: { select: { jobNumber: true } }, booking: { select: { bookingNumber: true } } },
    }),
    prisma.invoice.count({ where }),
  ]);
  return { rows, total, page: q.page, pageSize: 25 };
}
