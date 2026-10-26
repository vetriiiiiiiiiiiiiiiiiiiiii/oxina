import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { forbidden, invalid, notFound, rule } from "@/lib/errors";
import { assertBranch, branchFilter, can, requirePermission, type Actor } from "@/lib/rbac/actor";
import { audit } from "@/lib/audit";
import { nextNumber } from "@/lib/numbering";

// ─── Warranty claims ───

/** OEM representatives are restricted to their assigned business units (brands). */
function claimScope(actor: Actor, branchId?: string): Prisma.WarrantyClaimWhereInput {
  const isOem = actor.roles.includes("OEM_REPRESENTATIVE") && !actor.allBranches;
  return { ...branchFilter(actor, branchId), ...(isOem ? { businessUnitId: { in: actor.businessUnitIds }, status: { not: "DRAFT" } } : {}) };
}

export const claimInput = z.object({
  branchId: z.string().uuid(),
  serviceJobId: z.string().uuid().optional(),
  warrantyId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  manufacturer: z.string().trim().min(2).max(80),
  claimType: z.enum(["VEHICLE", "PART"]),
  description: z.string().trim().min(10).max(2000),
  claimAmount: z.coerce.number().min(0),
});

export async function createClaim(actor: Actor, input: z.infer<typeof claimInput>) {
  requirePermission(actor, "warranty.manage");
  assertBranch(actor, input.branchId, "Branch");
  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: input.branchId }, include: { businessUnit: true } });
    if (input.serviceJobId && !(await tx.serviceJob.findFirst({ where: { id: input.serviceJobId, branchId: branch.id } }))) throw invalid("Service job is not in this branch.");
    const c = await tx.warrantyClaim.create({ data: { ...input, businessUnitId: branch.businessUnitId, claimNumber: await nextNumber(tx, "WCL", branch.businessUnit.code), createdById: actor.userId } });
    await audit(tx, { actorId: actor.userId, action: "warranty.claim.create", entityType: "WarrantyClaim", entityId: c.id, branchId: branch.id });
    return c;
  });
}

const CLAIM_FLOW: Record<string, string[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["UNDER_REVIEW", "APPROVED", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["SETTLED"],
  REJECTED: [],
  SETTLED: [],
};

export const claimProgressInput = z.object({
  status: z.enum(["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "SETTLED"]),
  decisionReason: z.string().trim().max(1000).optional(),
  reimbursedAmount: z.coerce.number().min(0).optional(),
});

export async function progressClaim(actor: Actor, id: string, input: z.infer<typeof claimProgressInput>) {
  requirePermission(actor, "warranty.manage");
  const c = await prisma.warrantyClaim.findFirst({ where: { id, ...claimScope(actor) } });
  if (!c) throw notFound("Warranty claim");
  if (!CLAIM_FLOW[c.status].includes(input.status)) throw rule(`Claim cannot move from ${c.status} to ${input.status}.`);
  if (input.status === "REJECTED" && !input.decisionReason) throw invalid("Record the rejection reason.");
  if (input.status === "SETTLED" && input.reimbursedAmount === undefined) throw invalid("Record the reimbursed amount.");
  return prisma.$transaction(async (tx) => {
    const r = await tx.warrantyClaim.update({
      where: { id },
      data: {
        status: input.status, decisionReason: input.decisionReason ?? c.decisionReason, reimbursedAmount: input.reimbursedAmount ?? c.reimbursedAmount,
        ...(input.status === "SUBMITTED" ? { submittedAt: new Date() } : {}), ...(["APPROVED", "REJECTED", "SETTLED"].includes(input.status) ? { resolvedAt: new Date() } : {}),
      },
    });
    await audit(tx, { actorId: actor.userId, action: `warranty.claim.${input.status.toLowerCase()}`, entityType: "WarrantyClaim", entityId: id, branchId: c.branchId, before: { status: c.status }, after: input });
    return r;
  });
}

export async function listClaims(actor: Actor, q: { branchId?: string; status?: string }) {
  requirePermission(actor, "warranty.view");
  return prisma.warrantyClaim.findMany({
    where: { ...claimScope(actor, q.branchId), ...(q.status ? { status: q.status as never } : {}) },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { branch: { select: { name: true } }, businessUnit: { select: { name: true } }, serviceJob: { select: { id: true, jobNumber: true } }, supplier: { select: { name: true } } },
  });
}

export async function listWarranties(actor: Actor, q: { search?: string }) {
  requirePermission(actor, "warranty.view");
  const isOem = actor.roles.includes("OEM_REPRESENTATIVE") && !actor.allBranches;
  const scope = actor.allBranches ? {} : { OR: [{ vehicle: { branchId: { in: actor.branchIds } } }, { sparePartIssue: { request: { branchId: { in: actor.branchIds } } } }] };
  return prisma.warranty.findMany({
    where: {
      ...scope,
      ...(isOem ? { OR: [{ vehicle: { vehicleModel: { businessUnitId: { in: actor.businessUnitIds } } } }, { inventoryItem: { businessUnitId: { in: actor.businessUnitIds } } }] } : {}),
      ...(q.search ? { customerVehicle: { registrationNumber: { contains: q.search.replace(/\s/g, ""), mode: "insensitive" } } } : {}),
    },
    orderBy: { endDate: "asc" },
    take: 300,
    include: { customerVehicle: { select: { registrationNumber: true, modelName: true } }, inventoryItem: { select: { name: true, partNumber: true } }, vehicle: { select: { vin: true } } },
  });
}

// ─── Offers & coupons ───

export const offerInput = z.object({
  businessUnitId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(1000).optional(),
  appliesTo: z.enum(["VEHICLE_SALE", "SERVICE", "PARTS"]),
  discountType: z.enum(["PERCENT", "FLAT"]),
  discountValue: z.coerce.number().positive(),
  maxDiscount: z.coerce.number().positive().optional(),
  minOrderValue: z.coerce.number().min(0).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  coupons: z.array(z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{4,30}$/), usageLimit: z.coerce.number().int().positive().optional(), perCustomerLimit: z.coerce.number().int().positive().default(1) })).max(50).default([]),
});

export async function createOffer(actor: Actor, input: z.infer<typeof offerInput>) {
  requirePermission(actor, "offers.manage");
  if (input.endsAt <= input.startsAt) throw invalid("End must be after start.");
  if (input.discountType === "PERCENT" && input.discountValue > 100) throw invalid("Percentage cannot exceed 100.");
  if (input.branchId) assertBranch(actor, input.branchId, "Branch");
  else if (!actor.allBranches) throw forbidden("Only a Super Admin can create unit-wide offers. Choose a branch.");
  const { coupons, ...offer } = input;
  return prisma.$transaction(async (tx) => {
    if (input.branchId) {
      const b = await tx.branch.findUniqueOrThrow({ where: { id: input.branchId } });
      if (b.businessUnitId !== input.businessUnitId) throw invalid("Branch is not in this business unit.");
    }
    const o = await tx.offer.create({ data: { ...offer, createdById: actor.userId, coupons: { create: coupons } } });
    await audit(tx, { actorId: actor.userId, action: "offer.create", entityType: "Offer", entityId: o.id, branchId: input.branchId ?? null });
    return o;
  });
}

export async function setOfferActive(actor: Actor, id: string, isActive: boolean) {
  requirePermission(actor, "offers.manage");
  const o = await prisma.offer.findUnique({ where: { id } });
  if (!o) throw notFound("Offer");
  if (o.branchId) assertBranch(actor, o.branchId, "Offer");
  else if (!actor.allBranches) throw notFound("Offer");
  return prisma.offer.update({ where: { id }, data: { isActive } });
}

export async function listOffers(actor: Actor) {
  requirePermission(actor, "offers.view");
  const branchScope = actor.allBranches ? {} : { OR: [{ branchId: { in: actor.branchIds } }, { branchId: null, businessUnit: { branches: { some: { id: { in: actor.branchIds } } } } }] };
  return prisma.offer.findMany({
    where: branchScope,
    orderBy: { startsAt: "desc" },
    include: { coupons: true, branch: { select: { name: true } }, businessUnit: { select: { name: true } } },
  });
}

// ─── Expenses ───

export const expenseInput = z.object({ branchId: z.string().uuid(), category: z.string().trim().min(2).max(60), description: z.string().trim().min(3).max(500), amount: z.coerce.number().positive(), incurredOn: z.coerce.date() });

export async function submitExpense(actor: Actor, input: z.infer<typeof expenseInput>) {
  requirePermission(actor, "expenses.submit", "expenses.approve");
  assertBranch(actor, input.branchId, "Branch");
  return prisma.expense.create({ data: { ...input, submittedById: actor.userId } });
}

export async function reviewExpense(actor: Actor, id: string, approve: boolean) {
  requirePermission(actor, "expenses.approve");
  const e = await prisma.expense.findUnique({ where: { id } });
  if (!e) throw notFound("Expense");
  assertBranch(actor, e.branchId, "Expense");
  if (e.status !== "PENDING") throw rule("Already reviewed.");
  if (e.submittedById === actor.userId) throw forbidden("You cannot approve your own expense.");
  await prisma.$transaction(async (tx) => {
    await tx.expense.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", reviewedById: actor.userId, reviewedAt: new Date() } });
    await audit(tx, { actorId: actor.userId, action: approve ? "expense.approve" : "expense.reject", entityType: "Expense", entityId: id, branchId: e.branchId, after: { amount: e.amount } });
  });
}

export async function listExpenses(actor: Actor, q: { branchId?: string }) {
  if (!can(actor, "expenses.approve") && !can(actor, "expenses.submit")) throw forbidden();
  return prisma.expense.findMany({
    where: { ...branchFilter(actor, q.branchId), ...(can(actor, "expenses.approve") ? {} : { submittedById: actor.userId }) },
    orderBy: { incurredOn: "desc" },
    take: 200,
    include: { branch: { select: { name: true } } },
  });
}

// ─── Notifications ───

export async function listNotifications(actor: Actor, unreadOnly = false) {
  return prisma.notification.findMany({ where: { userId: actor.userId, ...(unreadOnly ? { readAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: 100 });
}

export async function unreadCount(actor: Actor) {
  return prisma.notification.count({ where: { userId: actor.userId, readAt: null } });
}

export async function markNotificationsRead(actor: Actor, ids?: string[]) {
  await prisma.notification.updateMany({ where: { userId: actor.userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
}

export const templateInput = z.object({ subject: z.string().trim().max(200).optional(), body: z.string().trim().min(10).max(4000), isActive: z.boolean().default(true) });

export async function upsertTemplate(actor: Actor, key: string, input: z.infer<typeof templateInput>) {
  requirePermission(actor, "notifications.templates.manage");
  const existing = await prisma.notificationTemplate.findFirst({ where: { key, channel: "EMAIL", businessUnitId: null } });
  const r = existing
    ? await prisma.notificationTemplate.update({ where: { id: existing.id }, data: input })
    : await prisma.notificationTemplate.create({ data: { key, channel: "EMAIL", ...input } });
  await audit(prisma, { actorId: actor.userId, action: "template.update", entityType: "NotificationTemplate", entityId: r.id, after: { key } });
  return r;
}

export async function listDeliveries(actor: Actor, branchId?: string) {
  requirePermission(actor, "notifications.templates.manage", "audit.view");
  return prisma.notificationDelivery.findMany({ where: actor.allBranches && !branchId ? {} : { branchId: branchFilter(actor, branchId).branchId }, orderBy: { createdAt: "desc" }, take: 100 });
}

// ─── Audit ───

export const auditQuery = z.object({ branchId: z.string().uuid().optional(), entityType: z.string().max(40).optional(), action: z.string().max(60).optional(), page: z.coerce.number().int().min(1).default(1) });

export async function listAudit(actor: Actor, q: z.infer<typeof auditQuery>) {
  requirePermission(actor, "audit.view");
  // Non-group users only see branch-scoped entries of their branches.
  const where: Prisma.AuditLogWhereInput = {
    ...(actor.allBranches ? (q.branchId ? { branchId: q.branchId } : {}) : { branchId: branchFilter(actor, q.branchId).branchId }),
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.action ? { action: { contains: q.action } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * 50, take: 50, include: { actor: { select: { name: true, email: true } } } }),
    prisma.auditLog.count({ where }),
  ]);
  return { rows, total, page: q.page, pageSize: 50 };
}
