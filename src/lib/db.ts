import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "test" ? [] : process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

/** Serializable transaction with automatic retry on serialization / deadlock failures. */
export async function serializable<T>(fn: (tx: Tx) => Promise<T>, retries = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 20_000,
      });
    } catch (e) {
      const code = (e as { code?: string }).code;
      const retryable = code === "P2034" || /40001|40P01|could not serialize/i.test(String((e as Error).message));
      if (!retryable || attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, 20 * (attempt + 1) + Math.random() * 30));
    }
  }
}
