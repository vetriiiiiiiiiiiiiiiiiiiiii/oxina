import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { currentMeta } from "@/lib/request-context";

const REDACT = /password|token|secret|identifier(Encrypted)?$|hash/i;

function scrub(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(
    JSON.stringify(v, (k, val) => (k && REDACT.test(k) ? "[redacted]" : typeof val === "bigint" ? val.toString() : val)),
  );
}

export async function audit(
  db: Db,
  entry: {
    actorId: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    branchId?: string | null;
    before?: unknown;
    after?: unknown;
  },
) {
  const meta = currentMeta();
  await db.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      branchId: entry.branchId ?? null,
      before: scrub(entry.before),
      after: scrub(entry.after),
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    },
  });
}

export const auditNow = (entry: Parameters<typeof audit>[1]) => audit(prisma, entry);
