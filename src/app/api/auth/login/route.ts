import { z } from "zod";
import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getDummyHash, verifyPassword } from "@/lib/auth/password";
import { assertLoginAllowed, recordLoginAttempt } from "@/lib/auth/rate-limit";
import { SESSION_COOKIE, cookieOptions, createSession } from "@/lib/auth/session";
import { currentMeta } from "@/lib/request-context";
import { audit } from "@/lib/audit";

const body = z.object({ identifier: z.string().trim().toLowerCase().min(3).max(200), password: z.string().min(1).max(200) });

export const POST = api({ auth: "public", body }, async ({ body }) => {
  const { ip, userAgent } = currentMeta();
  await assertLoginAllowed(body.identifier, ip);
  const user = await prisma.user.findFirst({ where: { OR: [{ email: body.identifier }, { username: body.identifier }] } });
  // Always run a hash verification so response time does not reveal whether the account exists.
  const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), body.password);
  if (!user || !ok || !user.isActive) {
    await recordLoginAttempt(body.identifier, ip, false);
    throw new AppError("UNAUTHENTICATED", user && ok && !user.isActive ? "This account is deactivated. Contact your administrator." : "Incorrect email/username or password.");
  }
  await recordLoginAttempt(body.identifier, ip, true);
  const { token, expiresAt } = await createSession(user.id, { ip, userAgent });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(prisma, { actorId: user.id, action: "auth.login", entityType: "User", entityId: user.id });
  const res = NextResponse.json({ ok: true, data: { redirect: user.mustChangePassword ? "/change-password" : user.userType === "CUSTOMER" ? "/portal" : "/dashboard" } });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
  return res;
});
