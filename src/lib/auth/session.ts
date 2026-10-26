import { sha256 } from "@oslojs/crypto/sha2";
import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from "@oslojs/encoding";
import { prisma } from "@/lib/db";

/**
 * Server-managed sessions (the pattern recommended by Lucia v3 maintainers):
 * a random 160-bit token is stored only in an httpOnly cookie; the database keeps its SHA-256.
 */
export const SESSION_COOKIE = "oxina_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h
const RENEW_WHEN_LEFT_MS = 1000 * 60 * 60 * 6;

export function generateToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return encodeBase32LowerCaseNoPadding(bytes);
}

export const hashToken = (token: string) => encodeHexLowerCase(sha256(new TextEncoder().encode(token)));

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { id: hashToken(token), userId, expiresAt, ipAddress: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null },
  });
  return { token, expiresAt };
}

export async function validateSessionToken(token: string) {
  const id = hashToken(token);
  const session = await prisma.session.findUnique({ where: { id }, select: { id: true, userId: true, expiresAt: true, user: { select: { isActive: true } } } });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now() || !session.user.isActive) {
    await prisma.session.delete({ where: { id } }).catch(() => {});
    return null;
  }
  let expiresAt = session.expiresAt;
  if (expiresAt.getTime() - Date.now() < RENEW_WHEN_LEFT_MS) {
    expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await prisma.session.update({ where: { id }, data: { expiresAt } });
  }
  return { sessionId: id, userId: session.userId, expiresAt };
}

export async function invalidateSession(token: string) {
  await prisma.session.deleteMany({ where: { id: hashToken(token) } });
}

export async function invalidateUserSessions(userId: string, exceptSessionId?: string) {
  await prisma.session.deleteMany({ where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) } });
}

export const cookieOptions = (expiresAt: Date) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  expires: expiresAt,
});
