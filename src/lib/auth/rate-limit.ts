import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";

/** Database-backed fixed-window limiter (works across multiple app containers). */
export async function rateLimit(bucket: string, limit: number, windowMs: number) {
  const since = new Date(Date.now() - windowMs);
  const count = await prisma.rateLimitHit.count({ where: { bucket, createdAt: { gte: since } } });
  if (count >= limit) throw new AppError("RATE_LIMITED", "Too many requests. Please wait and try again.");
  await prisma.rateLimitHit.create({ data: { bucket } });
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_ID = 5;
const MAX_FAILURES_PER_IP = 30;

export async function assertLoginAllowed(identifier: string, ip: string | null) {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);
  const [byId, byIp] = await Promise.all([
    prisma.loginAttempt.count({ where: { identifier, success: false, createdAt: { gte: since } } }),
    ip ? prisma.loginAttempt.count({ where: { ipAddress: ip, success: false, createdAt: { gte: since } } }) : 0,
  ]);
  if (byId >= MAX_FAILURES_PER_ID || byIp >= MAX_FAILURES_PER_IP) {
    throw new AppError("RATE_LIMITED", "Too many failed sign-in attempts. Try again in 15 minutes or reset your password.");
  }
}

export async function recordLoginAttempt(identifier: string, ip: string | null, success: boolean) {
  await prisma.loginAttempt.create({ data: { identifier, ipAddress: ip, success } });
}
