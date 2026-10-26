/**
 * First-run bootstrap for the Super Admin.
 *
 *   INITIAL_ADMIN_EMAIL=... INITIAL_ADMIN_PASSWORD=... npm run bootstrap:admin
 *
 * - Credentials come only from the deployment environment (never from source).
 * - Safe to re-run: if a Super Admin already exists, it does nothing.
 * - After success the bootstrap is locked (SystemFlag) — remove the variables from the environment.
 * - The admin must change the password at first sign-in.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword, strongPassword } from "../src/lib/auth/password";
import { syncRbac } from "../src/lib/rbac/sync";

const prisma = new PrismaClient();

async function main() {
  await syncRbac(prisma);
  const group = (await prisma.businessGroup.findFirst()) ?? (await prisma.businessGroup.create({ data: { name: "Oxina Groups", code: "OXINA" } }));

  const locked = await prisma.systemFlag.findUnique({ where: { key: "bootstrap.completed" } });
  const existing = await prisma.user.count({ where: { roles: { some: { role: { key: "SUPER_ADMIN" } } } } });
  if (locked || existing) {
    console.log("Bootstrap already completed — no changes made. (Roles/permissions were re-synced.)");
    return;
  }
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD ?? "";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Set INITIAL_ADMIN_EMAIL to a valid email address.");
  const check = strongPassword.safeParse(password);
  if (!check.success) throw new Error(`INITIAL_ADMIN_PASSWORD is too weak: ${check.error.issues.map((i) => i.message).join(" ")}`);

  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: process.env.INITIAL_ADMIN_NAME?.trim() || "Group Administrator",
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        roles: { create: { roleId: role.id } },
      },
    });
    await tx.systemFlag.create({ data: { key: "bootstrap.completed", value: new Date().toISOString() } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "system.bootstrap", entityType: "User", entityId: user.id, after: { email, group: group.code } } });
  });
  console.log(`Super Admin ${email} created. Sign in and change the password, then remove INITIAL_ADMIN_* from the environment.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
