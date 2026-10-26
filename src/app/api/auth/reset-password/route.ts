import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { invalid } from "@/lib/errors";
import { hashPassword, strongPassword } from "@/lib/auth/password";
import { hashToken, invalidateUserSessions } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { currentMeta } from "@/lib/request-context";
import { audit } from "@/lib/audit";

const body = z.object({ token: z.string().min(20).max(100), password: strongPassword });

export const POST = api({ auth: "public", body }, async ({ body }) => {
  await rateLimit(`reset:${currentMeta().ip ?? "unknown"}`, 10, 15 * 60_000);
  const rec = await prisma.passwordResetToken.findUnique({ where: { id: hashToken(body.token) } });
  if (!rec || rec.usedAt || rec.expiresAt < new Date()) throw invalid("This link is invalid or has expired. Request a new one.");
  await prisma.$transaction([
    prisma.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: rec.userId }, data: { passwordHash: await hashPassword(body.password), mustChangePassword: false, passwordChangedAt: new Date() } }),
  ]);
  await invalidateUserSessions(rec.userId);
  await audit(prisma, { actorId: rec.userId, action: "auth.password_reset", entityType: "User", entityId: rec.userId });
  return { redirect: "/login" };
});
