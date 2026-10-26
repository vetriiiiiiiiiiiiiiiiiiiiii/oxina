import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function key() {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) throw new Error("DATA_ENCRYPTION_KEY is not configured");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes (base64)");
  return k;
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(payload: string) {
  const [v, iv, tag, ct] = payload.split(".");
  if (v !== "v1") throw new Error("Unknown ciphertext version");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

export function mask(value: string | null | undefined, visible = 4) {
  if (!value) return "";
  const clean = value.replace(/\s+/g, "");
  if (clean.length <= visible) return "•".repeat(clean.length);
  return "•".repeat(Math.min(8, clean.length - visible)) + clean.slice(-visible);
}

export const maskPhone = (p: string | null | undefined) => (p ? p.slice(0, 3) + "•••••" + p.slice(-2) : "");

function signingSecret() {
  const s = process.env.FILE_SIGNING_SECRET;
  if (!s || s.length < 32) throw new Error("FILE_SIGNING_SECRET must be at least 32 characters");
  return s;
}

/** Short-lived signed token bound to a file and a user. */
export function signFileToken(fileId: string, userId: string, ttlSeconds = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = `${fileId}.${userId}.${exp}`;
  const sig = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  return `${exp}.${sig}`;
}

export function verifyFileToken(fileId: string, userId: string, token: string) {
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!exp || !sig || exp < Date.now() / 1000) return false;
  // Compare the canonical encoded form, so alternative encodings of the same bytes are rejected too.
  const expected = Buffer.from(createHmac("sha256", signingSecret()).update(`${fileId}.${userId}.${exp}`).digest("base64url"));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
