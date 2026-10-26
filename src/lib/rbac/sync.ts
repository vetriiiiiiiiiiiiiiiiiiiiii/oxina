import type { PrismaClient } from "@prisma/client";
import { PERMISSIONS, ROLES } from "./permissions";

/** Idempotently sync the role–permission matrix in permissions.ts into the database. */
export async function syncRbac(db: PrismaClient) {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({ where: { key }, create: { key, description, module: key.split(".")[0] }, update: { description, module: key.split(".")[0] } });
  }
  const perms = await db.permission.findMany();
  const byKey = new Map(perms.map((p) => [p.key, p.id]));
  for (const r of ROLES) {
    const role = await db.role.upsert({
      where: { key: r.key },
      create: { key: r.key, name: r.name, description: r.description, scope: r.scope },
      update: { name: r.name, description: r.description, scope: r.scope },
    });
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({ data: r.permissions.map((p) => ({ roleId: role.id, permissionId: byKey.get(p)! })) });
  }
}
