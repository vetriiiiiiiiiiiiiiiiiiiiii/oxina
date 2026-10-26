import type { Db } from "@/lib/db";
import { DEFAULT_TEMPLATES, renderTemplate } from "./templates";

/** In-app notification to specific staff/customer users. */
export async function notifyUsers(
  db: Db,
  userIds: (string | null | undefined)[],
  n: { type: string; title: string; body: string; link?: string; branchId?: string | null },
) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  await db.notification.createMany({
    data: ids.map((userId) => ({ userId, type: n.type, title: n.title, body: n.body, link: n.link ?? null, branchId: n.branchId ?? null })),
  });
}

/** Users in a branch holding any of the given roles (e.g. warehouse team). */
export async function branchUsersWithRoles(db: Db, branchId: string, roleKeys: string[]) {
  const rows = await db.user.findMany({
    where: {
      isActive: true,
      branchAssignments: { some: { branchId } },
      roles: { some: { role: { key: { in: roleKeys } } } },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Queue an external message (email today; SMS/WhatsApp providers are optional and not implemented).
 * The worker sends it and records the provider result. Nothing here claims delivery.
 */
export async function queueCustomerMessage(
  db: Db,
  args: {
    templateKey: string;
    businessUnitId: string;
    values: Record<string, string | null | undefined>;
    email?: string | null;
    customerId: string;
    branchId: string;
    serviceJobId?: string;
  },
) {
  if (!args.email) return;
  const custom = await db.notificationTemplate.findFirst({
    where: { key: args.templateKey, channel: "EMAIL", isActive: true, OR: [{ businessUnitId: args.businessUnitId }, { businessUnitId: null }] },
    orderBy: { businessUnitId: { sort: "desc", nulls: "last" } },
  });
  const tpl = custom ?? DEFAULT_TEMPLATES.find((t) => t.key === args.templateKey && t.channel === "EMAIL");
  if (!tpl) return;
  await db.notificationDelivery.create({
    data: {
      channel: "EMAIL",
      recipient: args.email,
      templateKey: args.templateKey,
      subject: tpl.subject ? renderTemplate(tpl.subject, args.values) : null,
      body: renderTemplate(tpl.body, args.values),
      branchId: args.branchId,
      customerId: args.customerId,
      serviceJobId: args.serviceJobId ?? null,
    },
  });
}
