import { prisma, type Db } from "@/lib/db";
import { forbidden, notFound } from "@/lib/errors";
import type { PermissionKey } from "./permissions";

/**
 * The authenticated principal for a request. Built only on the server from the session —
 * never from client-supplied data. Branch scope is resolved from role scope + assignments.
 */
export interface Actor {
  userId: string;
  name: string;
  email: string;
  kind: "STAFF" | "CUSTOMER";
  roles: string[];
  permissions: Set<string>;
  /** true when any role has GROUP scope (Super Admin). */
  allBranches: boolean;
  /** Branches the actor may access (explicit + via business-unit assignment). Empty when allBranches. */
  branchIds: string[];
  businessUnitIds: string[];
  customerId: string | null;
  mustChangePassword: boolean;
}

export async function loadActor(userId: string, db: Db = prisma): Promise<Actor | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      branchAssignments: { include: { branch: { select: { isActive: true } } } },
      businessUnitAssignments: true,
      customer: { select: { id: true } },
    },
  });
  if (!user || !user.isActive) return null;

  const permissions = new Set<string>();
  let allBranches = false;
  for (const ur of user.roles) {
    if (ur.role.scope === "GROUP") allBranches = true;
    for (const rp of ur.role.permissions) permissions.add(rp.permission.key);
  }
  const businessUnitIds = user.businessUnitAssignments.map((a) => a.businessUnitId);
  const branchIds = new Set(user.branchAssignments.map((a) => a.branchId));
  if (!allBranches && businessUnitIds.length) {
    const unitBranches = await db.branch.findMany({
      where: { businessUnitId: { in: businessUnitIds } },
      select: { id: true },
    });
    unitBranches.forEach((b) => branchIds.add(b.id));
  }

  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    kind: user.userType,
    roles: user.roles.map((r) => r.role.key),
    permissions,
    allBranches,
    branchIds: allBranches ? [] : [...branchIds],
    businessUnitIds,
    customerId: user.customer?.id ?? null,
    mustChangePassword: user.mustChangePassword,
  };
}

export function can(actor: Actor, permission: PermissionKey): boolean {
  return actor.permissions.has(permission);
}

export function canAny(actor: Actor, ...permissions: PermissionKey[]): boolean {
  return permissions.some((p) => actor.permissions.has(p));
}

export function requirePermission(actor: Actor, ...anyOf: PermissionKey[]) {
  if (actor.kind !== "STAFF" && !anyOf.includes("portal.access")) throw forbidden();
  if (!anyOf.some((p) => actor.permissions.has(p))) throw forbidden();
}

export function hasBranch(actor: Actor, branchId: string): boolean {
  return actor.kind === "STAFF" && (actor.allBranches || actor.branchIds.includes(branchId));
}

/**
 * Throws NOT_FOUND (not FORBIDDEN) for out-of-scope branches so record existence in
 * other branches is not disclosed.
 */
export function assertBranch(actor: Actor, branchId: string, what = "Record") {
  if (!hasBranch(actor, branchId)) throw notFound(what);
}

/** Prisma `where` fragment restricting a model with a `branchId` column to the actor's scope. */
export function branchFilter(actor: Actor, requested?: string | null): { branchId?: string | { in: string[] } } {
  if (actor.kind !== "STAFF") return { branchId: { in: [] } };
  if (requested) {
    assertBranch(actor, requested, "Branch");
    return { branchId: requested };
  }
  return actor.allBranches ? {} : { branchId: { in: actor.branchIds } };
}

/** Same as branchFilter but for models keyed by a different column. */
export function branchIn(actor: Actor, requested?: string | null): string | { in: string[] } | undefined {
  const f = branchFilter(actor, requested);
  return f.branchId;
}

/** Which parts of the business a manager runs. Branch Managers, owners and admins run all of them. */
export function managerAreas(actor: Actor) {
  const group = can(actor, "dashboard.group");
  return {
    workshop: group || can(actor, "service.job.manage"),
    showroom: group || can(actor, "showroom.pricing.approve"),
    stores: group || can(actor, "purchases.approve"),
    money: group || can(actor, "billing.manage") || can(actor, "billing.credit_note"),
    people: group || can(actor, "attendance.manage"),
  };
}
