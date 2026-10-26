import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

// OWASP-recommended argon2id parameters.
const OPTS = { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, OPTS);
export async function verifyPassword(hashValue: string, password: string) {
  try {
    return await verify(hashValue, password);
  } catch {
    return false;
  }
}

export const strongPassword = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p), {
    message: "Include upper- and lower-case letters, a number and a symbol.",
  });

/** A real argon2 hash of a random value; used to keep timing constant for unknown users. */
let dummyHash: Promise<string> | null = null;
export const getDummyHash = () => (dummyHash ??= hashPassword(crypto.randomUUID() + "Aa1!"));
