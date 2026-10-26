import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, type Db, type Tx } from "@/lib/db";
import { conflict, notFound, rule } from "@/lib/errors";
import { assertBranch, requirePermission, type Actor } from "@/lib/rbac/actor";
import { audit } from "@/lib/audit";
import { nextNumber } from "@/lib/numbering";
import { hashPassword } from "@/lib/auth/password";
import { generateToken, hashToken } from "@/lib/auth/session";
import { decrypt, encrypt, mask } from "@/lib/crypto";

export const phoneSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\+?\d{10,13}$/, "Enter a valid phone number."));

export const customerInput = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  email: z.string().trim().toLowerCase().email().max(200).optional().or(z.literal("").transform(() => undefined)),
  addressLine: z.string().trim().max(300).optional(),
  city: z.string().trim().max(80).optional(),
  stateCode: z.string().trim().max(4).optional(),
  postalCode: z.string().trim().max(12).optional(),
});

/** Customers are group-wide; staff see those created at, or transacting with, their branches. */
export function customerScope(actor: Actor): Prisma.CustomerWhereInput {
  if (actor.allBranches) return {};
  const ids = actor.branchIds;
  return {
    OR: [
      { createdAtBranchId: { in: ids } },
      { serviceJobs: { some: { branchId: { in: ids } } } },
      { bookings: { some: { branchId: { in: ids } } } },
      { leads: { some: { branchId: { in: ids } } } },
    ],
  };
}

export async function getCustomerForActor(actor: Actor, id: string, db: Db = prisma) {
  if (actor.kind === "CUSTOMER") {
    if (actor.customerId !== id) throw notFound("Customer");
    return db.customer.findUniqueOrThrow({ where: { id } });
  }
  requirePermission(actor, "customers.view");
  const c = await db.customer.findFirst({ where: { id, ...customerScope(actor) } });
  if (!c) throw notFound("Customer");
  return c;
}

export async function listCustomers(actor: Actor, q: { search?: string; page?: number; pageSize?: number }) {
  requirePermission(actor, "customers.view");
  const pageSize = Math.min(q.pageSize ?? 25, 100);
  const page = Math.max(1, q.page ?? 1);
  const s = q.search?.trim();
  const where: Prisma.CustomerWhereInput = {
    AND: [
      customerScope(actor),
      s
        ? {
            OR: [
              { fullName: { contains: s, mode: "insensitive" } },
              { phone: { contains: s.replace(/\s/g, "") } },
              { customerCode: { contains: s, mode: "insensitive" } },
              { vehicles: { some: { registrationNumber: { contains: s.replace(/\s/g, ""), mode: "insensitive" } } } },
            ],
          }
        : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { vehicles: { select: { registrationNumber: true, modelName: true } }, _count: { select: { serviceJobs: true } } },
    }),
    prisma.customer.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function createCustomerTx(tx: Tx, actor: Actor, branchId: string, input: z.infer<typeof customerInput>) {
  const branch = await tx.branch.findUniqueOrThrow({ where: { id: branchId }, include: { businessUnit: true } });
  const existing = await tx.customer.findFirst({ where: { phone: input.phone } });
  if (existing) throw conflict("A customer with this phone number already exists. Search and select them instead.");
  const customerCode = await nextNumber(tx, "CUST", branch.businessUnit.code);
  const c = await tx.customer.create({ data: { ...input, customerCode, createdAtBranchId: branchId } });
  await tx.customerConsent.create({
    data: { customerId: c.id, purpose: "SERVICE_COMMUNICATION", granted: true, noticeVersion: "2026-10", capturedById: actor.userId },
  });
  await audit(tx, { actorId: actor.userId, action: "customer.create", entityType: "Customer", entityId: c.id, branchId, after: { customerCode } });
  return c;
}

export async function createCustomer(actor: Actor, branchId: string, input: z.infer<typeof customerInput>) {
  requirePermission(actor, "customers.manage");
  assertBranch(actor, branchId, "Branch");
  return prisma.$transaction((tx) => createCustomerTx(tx, actor, branchId, input));
}

export async function updateCustomer(actor: Actor, id: string, input: Partial<z.infer<typeof customerInput>>) {
  requirePermission(actor, "customers.manage");
  const before = await getCustomerForActor(actor, id);
  return prisma.$transaction(async (tx) => {
    const c = await tx.customer.update({ where: { id }, data: input });
    await audit(tx, { actorId: actor.userId, action: "customer.update", entityType: "Customer", entityId: id, before, after: c });
    return c;
  });
}

/**
 * Create (or re-issue) customer-portal access. Returns a one-time setup link valid for 72 hours,
 * which staff hand to the customer. The link is never stored in plain text.
 */
export async function issuePortalAccess(actor: Actor, customerId: string) {
  requirePermission(actor, "customers.manage");
  const c = await getCustomerForActor(actor, customerId);
  if (!c.email) throw rule("Add the customer's email address first — it is their portal sign-in.");
  const token = generateToken();
  await prisma.$transaction(async (tx) => {
    let userId = c.userId;
    if (!userId) {
      const clash = await tx.user.findUnique({ where: { email: c.email! } });
      if (clash) throw conflict("This email is already used by another account.");
      const role = await tx.role.findUniqueOrThrow({ where: { key: "CUSTOMER" } });
      const u = await tx.user.create({
        data: {
          email: c.email!,
          name: c.fullName,
          phone: c.phone,
          userType: "CUSTOMER",
          passwordHash: await hashPassword(generateToken() + "Aa1!"),
          mustChangePassword: false,
          roles: { create: { roleId: role.id } },
        },
      });
      await tx.customer.update({ where: { id: c.id }, data: { userId: u.id } });
      userId = u.id;
    }
    await tx.passwordResetToken.create({ data: { id: hashToken(token), userId, expiresAt: new Date(Date.now() + 72 * 3600_000) } });
    await audit(tx, { actorId: actor.userId, action: "customer.portal_access_issued", entityType: "Customer", entityId: c.id });
  });
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return { setupUrl: `${base}/reset-password?token=${token}`, expiresInHours: 72 };
}

export const documentInput = z.object({
  documentType: z.enum(["AADHAAR", "PAN", "DRIVING_LICENCE", "RC", "INSURANCE", "OTHER"]),
  purpose: z.string().trim().min(5, "State why this document is needed.").max(200),
  identifier: z.string().trim().max(40).optional(),
  branchId: z.string().uuid(),
  retainUntil: z.coerce.date().optional(),
});

/** Optional identity documents: identifier encrypted at rest, only masked form returned. */
export async function addCustomerDocument(actor: Actor, customerId: string, input: z.infer<typeof documentInput>, fileId?: string) {
  requirePermission(actor, "customers.sensitive.view");
  assertBranch(actor, input.branchId, "Branch");
  await getCustomerForActor(actor, customerId);
  return prisma.$transaction(async (tx) => {
    const doc = await tx.customerDocument.create({
      data: {
        customerId,
        branchId: input.branchId,
        documentType: input.documentType,
        purpose: input.purpose,
        identifierEncrypted: input.identifier ? encrypt(input.identifier) : null,
        identifierMasked: input.identifier ? mask(input.identifier) : null,
        fileId: fileId ?? null,
        uploadedById: actor.userId,
        retainUntil: input.retainUntil ?? null,
      },
      select: { id: true, documentType: true, identifierMasked: true, purpose: true, createdAt: true },
    });
    await audit(tx, { actorId: actor.userId, action: "customer.document.add", entityType: "CustomerDocument", entityId: doc.id, branchId: input.branchId, after: { documentType: input.documentType } });
    return doc;
  });
}

/** Reveal a full identifier — permission-checked and audited every time. */
export async function revealCustomerDocument(actor: Actor, documentId: string) {
  requirePermission(actor, "customers.sensitive.view");
  const doc = await prisma.customerDocument.findUnique({ where: { id: documentId } });
  if (!doc) throw notFound("Document");
  assertBranch(actor, doc.branchId, "Document");
  await audit(prisma, { actorId: actor.userId, action: "customer.document.reveal", entityType: "CustomerDocument", entityId: doc.id, branchId: doc.branchId });
  return { identifier: doc.identifierEncrypted ? decrypt(doc.identifierEncrypted) : null };
}
