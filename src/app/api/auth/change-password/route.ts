import { z } from "zod";
import { cookies } from "next/headers";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { invalid } from "@/lib/errors";
import { hashPassword, strongPassword, verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE, hashToken, invalidateUserSessions } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

const body = z.object({ currentPassword: z.string().min(1), newPassword: strongPassword });

export const POST = api({ auth: "any", body }, async ({ actor, body }) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!(await verifyPassword(user.passwordHash, body.currentPassword))) throw invalid("Current password is incorrect.");
  if (body.currentPassword === body.newPassword) throw invalid("Choose a password different from the current one.");
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.newPassword), mustChangePassword: false, passwordChangedAt: new Date() } });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  await invalidateUserSessions(user.id, token ? hashToken(token) : undefined);
  await audit(prisma, { actorId: user.id, action: "auth.password_change", entityType: "User", entityId: user.id });
  return { redirect: user.userType === "CUSTOMER" ? "/portal" : "/dashboard" };
});
