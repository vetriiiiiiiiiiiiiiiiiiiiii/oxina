import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { conflict, forbidden, invalid, notFound, rule } from "@/lib/errors";
import { assertBranch, branchFilter, requirePermission, type Actor } from "@/lib/rbac/actor";
import { audit } from "@/lib/audit";
import { hashPassword, strongPassword } from "@/lib/auth/password";
import { generateToken, hashToken, invalidateUserSessions } from "@/lib/auth/session";
import { ROLES } from "@/lib/rbac/permissions";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");

export const businessUnitInput = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/, "2–8 letters/digits"),
  type: z.enum(["AUTOMOTIVE_DEALERSHIP", "HOTEL", "RESTAURANT", "OTHER"]),
  brand: z.string().trim().max(60).optional(),
});

export const branchInput = z.object({
  businessUnitId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,20}$/, "3–20 letters/digits/dashes"),
  addressLine: z.string().trim().max(300).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  stateCode: z.string().trim().max(4).optional(),
  postalCode: z.string().trim().max(12).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  gstin: z.string().trim().toUpperCase().max(15).optional(),
  timezone: z.string().default("Asia/Kolkata").refine((tz) => {
    try {
      Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone"),
  workdayStart: hhmm.default("09:30"),
  workdayEnd: hhmm.default("18:30"),
  workingDays: z.array(z.number().int().min(1).max(7)).min(1).default([1, 2, 3, 4, 5, 6]),
  serviceBays: z.coerce.number().int().min(0).max(200).default(4),
});

export async function listBusinessUnits(actor: Actor) {
  requirePermission(actor, "org.view");
  const branchWhere: Prisma.BranchWhereInput = actor.allBranches ? {} : { id: { in: actor.branchIds } };
  return prisma.businessUnit.findMany({
    where: actor.allBranches ? {} : { branches: { some: branchWhere } },
    orderBy: { name: "asc" },
    include: { branches: { where: branchWhere, orderBy: { name: "asc" } } },
  });
}

export async function createBusinessUnit(actor: Actor, input: z.infer<typeof businessUnitInput>) {
  requirePermission(actor, "org.manage");
  const group = await prisma.businessGroup.findFirstOrThrow();
  return prisma.$transaction(async (tx) => {
    const bu = await tx.businessUnit.create({ data: { ...input, groupId: group.id } });
    await audit(tx, { actorId: actor.userId, action: "org.business_unit.create", entityType: "BusinessUnit", entityId: bu.id, after: bu });
    return bu;
  });
}

export async function updateBusinessUnit(actor: Actor, id: string, input: Partial<z.infer<typeof businessUnitInput>> & { isActive?: boolean }) {
  requirePermission(actor, "org.manage");
  const before = await prisma.businessUnit.findUnique({ where: { id } });
  if (!before) throw notFound("Business unit");
  return prisma.$transaction(async (tx) => {
    const bu = await tx.businessUnit.update({ where: { id }, data: input });
    await audit(tx, { actorId: actor.userId, action: "org.business_unit.update", entityType: "BusinessUnit", entityId: id, before, after: bu });
    return bu;
  });
}

export async function createBranch(actor: Actor, input: z.infer<typeof branchInput>) {
  requirePermission(actor, "org.manage");
  if (input.workdayEnd <= input.workdayStart) throw invalid("Workday end must be after start.");
  return prisma.$transaction(async (tx) => {
    const unit = await tx.businessUnit.findUnique({ where: { id: input.businessUnitId } });
    if (!unit || !unit.isActive) throw invalid("Choose an active business unit.");
    const branch = await tx.branch.create({ data: input });
    // Sensible defaults so the branch is usable immediately.
    await tx.inventoryLocation.createMany({
      data: [
        { branchId: branch.id, code: "WH", name: "Main Warehouse", type: "WAREHOUSE" },
        { branchId: branch.id, code: "SVC", name: "Service Parts Store", type: "SERVICE_STORE" },
      ],
    });
    await tx.department.createMany({
      data: ["Showroom", "Service", "Warehouse", "Accounts"].map((name) => ({ branchId: branch.id, name, type: name.toUpperCase() })),
    });
    await audit(tx, { actorId: actor.userId, action: "org.branch.create", entityType: "Branch", entityId: branch.id, branchId: branch.id, after: branch });
    return branch;
  });
}

export async function updateBranch(actor: Actor, id: string, input: Partial<z.infer<typeof branchInput>> & { isActive?: boolean }) {
  const before = await prisma.branch.findUnique({ where: { id } });
  if (!before) throw notFound("Branch");
  requirePermission(actor, "org.manage");
  // A branch cannot move to another business unit.
  const data = { ...input, businessUnitId: undefined };
  return prisma.$transaction(async (tx) => {
    const b = await tx.branch.update({ where: { id }, data });
    await audit(tx, { actorId: actor.userId, action: input.isActive === false ? "org.branch.deactivate" : "org.branch.update", entityType: "Branch", entityId: id, branchId: id, before, after: b });
    return b;
  });
}

export async function getBranch(actor: Actor, id: string) {
  requirePermission(actor, "org.view", "dashboard.branch");
  assertBranch(actor, id, "Branch");
  const b = await prisma.branch.findUnique({ where: { id }, include: { businessUnit: true, locations: true, departments: true, holidays: { orderBy: { date: "asc" } } } });
  if (!b) throw notFound("Branch");
  return b;
}

/** Branches the actor may pick in selectors (active only unless asked). */
export async function accessibleBranches(actor: Actor, includeInactive = false) {
  if (actor.kind !== "STAFF") return [];
  return prisma.branch.findMany({
    where: { ...(actor.allBranches ? {} : { id: { in: actor.branchIds } }), ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ businessUnit: { name: "asc" } }, { name: "asc" }],
    select: { id: true, name: true, code: true, isActive: true, timezone: true, businessUnitId: true, businessUnit: { select: { name: true, code: true } } },
  });
}

export const holidayInput = z.object({ date: z.coerce.date(), name: z.string().trim().min(2).max(80) });
export async function addHoliday(actor: Actor, branchId: string, input: z.infer<typeof holidayInput>) {
  requirePermission(actor, "settings.manage", "org.manage");
  assertBranch(actor, branchId, "Branch");
  return prisma.holiday.create({ data: { branchId, date: input.date, name: input.name } });
}

// ─── Users ───

export const userCreateInput = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/).optional().or(z.literal("").transform(() => undefined)),
  phone: z.string().trim().max(20).optional(),
  roleKeys: z.array(z.string()).min(1),
  branchIds: z.array(z.string().uuid()).default([]),
  businessUnitIds: z.array(z.string().uuid()).default([]),
  temporaryPassword: strongPassword,
});

/**
 * Non-super-admins may only grant branch-scoped roles in branches they manage, and never
 * roles with permissions they do not hold themselves (no privilege escalation).
 */
async function assertCanGrant(actor: Actor, roleKeys: string[], branchIds: string[], businessUnitIds: string[]) {
  requirePermission(actor, "users.manage");
  const roles = await prisma.role.findMany({ where: { key: { in: roleKeys } }, include: { permissions: { include: { permission: true } } } });
  if (roles.length !== roleKeys.length) throw invalid("Unknown role.");
  if (roles.some((r) => r.key === "CUSTOMER")) throw invalid("Customer accounts are created from the customer record.");
  for (const r of roles) {
    for (const p of r.permissions) if (!actor.permissions.has(p.permission.key)) throw forbidden(`You cannot grant the ${r.name} role.`);
    if (r.scope !== "BRANCH" && !actor.allBranches) throw forbidden(`Only a Super Admin can grant the ${r.name} role.`);
  }
  for (const b of branchIds) assertBranch(actor, b, "Branch");
  if (businessUnitIds.length && !actor.allBranches) throw forbidden("Only a Super Admin can assign business units.");
  const needsBranch = roles.some((r) => r.scope === "BRANCH");
  if (needsBranch && !branchIds.length) throw invalid("Assign at least one branch for branch-level roles.");
  const needsUnit = roles.some((r) => r.scope === "BUSINESS_UNIT");
  if (needsUnit && !businessUnitIds.length) throw invalid("Assign at least one business unit for this role.");
  return roles;
}

export async function createUser(actor: Actor, input: z.infer<typeof userCreateInput>) {
  const roles = await assertCanGrant(actor, input.roleKeys, input.branchIds, input.businessUnitIds);
  const exists = await prisma.user.findFirst({ where: { OR: [{ email: input.email }, ...(input.username ? [{ username: input.username }] : [])] } });
  if (exists) throw conflict("A user with this email or username already exists.");
  const passwordHash = await hashPassword(input.temporaryPassword);
  return prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        name: input.name, email: input.email, username: input.username ?? null, phone: input.phone, passwordHash, mustChangePassword: true, userType: "STAFF",
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
        branchAssignments: { create: input.branchIds.map((branchId, i) => ({ branchId, isPrimary: i === 0 })) },
        businessUnitAssignments: { create: input.businessUnitIds.map((businessUnitId) => ({ businessUnitId })) },
      },
      select: { id: true, name: true, email: true },
    });
    await audit(tx, { actorId: actor.userId, action: "user.create", entityType: "User", entityId: u.id, after: { email: u.email, roles: input.roleKeys, branches: input.branchIds } });
    return u;
  });
}

export const userUpdateInput = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(20).optional(),
  roleKeys: z.array(z.string()).min(1).optional(),
  branchIds: z.array(z.string().uuid()).optional(),
  businessUnitIds: z.array(z.string().uuid()).optional(),
  isActive: z.boolean().optional(),
});

async function loadManagedUser(actor: Actor, id: string) {
  const u = await prisma.user.findUnique({ where: { id }, include: { roles: { include: { role: true } }, branchAssignments: true, businessUnitAssignments: true } });
  if (!u || u.userType !== "STAFF") throw notFound("User");
  if (!actor.allBranches) {
    if (u.roles.some((r) => r.role.scope !== "BRANCH")) throw notFound("User");
    if (!u.branchAssignments.length || !u.branchAssignments.every((b) => actor.branchIds.includes(b.branchId))) throw notFound("User");
  }
  return u;
}

export async function updateUser(actor: Actor, id: string, input: z.infer<typeof userUpdateInput>) {
  requirePermission(actor, "users.manage");
  const before = await loadManagedUser(actor, id);
  if (id === actor.userId && (input.isActive === false || input.roleKeys)) throw rule("You cannot deactivate or change roles on your own account.");
  const roleKeys = input.roleKeys ?? before.roles.map((r) => r.role.key);
  const branchIds = input.branchIds ?? before.branchAssignments.map((b) => b.branchId);
  const unitIds = input.businessUnitIds ?? before.businessUnitAssignments.map((b) => b.businessUnitId);
  const roles = await assertCanGrant(actor, roleKeys, branchIds, input.businessUnitIds ? unitIds : []);
  if (before.roles.some((r) => r.role.key === "SUPER_ADMIN") && (input.isActive === false || (input.roleKeys && !input.roleKeys.includes("SUPER_ADMIN")))) {
    const admins = await prisma.user.count({ where: { isActive: true, roles: { some: { role: { key: "SUPER_ADMIN" } } } } });
    if (admins <= 1) throw rule("At least one active Super Admin is required.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { name: input.name, phone: input.phone, isActive: input.isActive } });
    if (input.roleKeys) {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id })) });
    }
    if (input.branchIds) {
      await tx.userBranchAssignment.deleteMany({ where: { userId: id } });
      await tx.userBranchAssignment.createMany({ data: branchIds.map((branchId, i) => ({ userId: id, branchId, isPrimary: i === 0 })) });
    }
    if (input.businessUnitIds) {
      await tx.userBusinessUnitAssignment.deleteMany({ where: { userId: id } });
      await tx.userBusinessUnitAssignment.createMany({ data: unitIds.map((businessUnitId) => ({ userId: id, businessUnitId })) });
    }
    await audit(tx, {
      actorId: actor.userId, action: input.isActive === false ? "user.deactivate" : "user.update", entityType: "User", entityId: id,
      before: { roles: before.roles.map((r) => r.role.key), branches: before.branchAssignments.map((b) => b.branchId), isActive: before.isActive },
      after: { roles: roleKeys, branches: branchIds, isActive: input.isActive ?? before.isActive },
    });
  });
  if (input.isActive === false || input.roleKeys || input.branchIds) await invalidateUserSessions(id);
}

/** Admin-initiated password reset: returns a one-time link (valid 24h) to hand over securely. */
export async function adminResetPassword(actor: Actor, id: string) {
  requirePermission(actor, "users.manage");
  await loadManagedUser(actor, id);
  const token = generateToken();
  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.create({ data: { id: hashToken(token), userId: id, expiresAt: new Date(Date.now() + 24 * 3600_000) } });
    await audit(tx, { actorId: actor.userId, action: "user.password_reset_issued", entityType: "User", entityId: id });
  });
  return { resetUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/reset-password?token=${token}` };
}

export async function listUsers(actor: Actor, q: { branchId?: string; search?: string }) {
  requirePermission(actor, "users.view");
  const scope = branchFilter(actor, q.branchId);
  const where: Prisma.UserWhereInput = {
    userType: "STAFF",
    ...(scope.branchId ? { branchAssignments: { some: { branchId: scope.branchId } } } : {}),
    ...(q.search ? { OR: [{ name: { contains: q.search, mode: "insensitive" } }, { email: { contains: q.search, mode: "insensitive" } }] } : {}),
  };
  return prisma.user.findMany({
    where,
    orderBy: { name: "asc" },
    take: 300,
    select: {
      id: true, name: true, email: true, username: true, phone: true, isActive: true, lastLoginAt: true, mustChangePassword: true,
      roles: { select: { role: { select: { key: true, name: true } } } },
      branchAssignments: { select: { branch: { select: { id: true, name: true, code: true } } } },
      businessUnitAssignments: { select: { businessUnit: { select: { id: true, name: true } } } },
      employee: { select: { employeeCode: true } },
    },
  });
}

export async function roleMatrix() {
  return prisma.role.findMany({ orderBy: { name: "asc" }, include: { permissions: { include: { permission: true } } } });
}

/** Staff users in a branch with a given role (for assignment pickers). */
export async function branchStaff(actor: Actor, branchId: string, roleKeys?: string[]) {
  if (actor.kind !== "STAFF") throw forbidden();
  assertBranch(actor, branchId, "Branch");
  return prisma.user.findMany({
    where: { isActive: true, userType: "STAFF", branchAssignments: { some: { branchId } }, ...(roleKeys ? { roles: { some: { role: { key: { in: roleKeys } } } } } : {}) },
    select: { id: true, name: true, roles: { select: { role: { select: { key: true } } } }, employee: { select: { employeeCode: true } } },
    orderBy: { name: "asc" },
  });
}

export { ROLES };
