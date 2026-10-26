import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export interface StorageDriver {
  put(key: string, data: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

class LocalDriver implements StorageDriver {
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data, { mode: 0o640 });
  }
  get(key: string) {
    return readFile(this.resolve(key));
  }
}

class S3Driver implements StorageDriver {
  private clientP = import("@aws-sdk/client-s3").then(
    (m) =>
      ({
        m,
        c: new m.S3Client({
          endpoint: process.env.S3_ENDPOINT || undefined,
          region: process.env.S3_REGION || "auto",
          forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
          credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
        }),
      }) as const,
  );
  async put(key: string, data: Buffer, mimeType: string) {
    const { m, c } = await this.clientP;
    await c.send(new m.PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key, Body: data, ContentType: mimeType, ServerSideEncryption: "AES256" }));
  }
  async get(key: string) {
    const { m, c } = await this.clientP;
    const out = await c.send(new m.GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
    return Buffer.from(await out.Body!.transformToByteArray());
  }
}

let driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  if (!driver) {
    driver = process.env.STORAGE_DRIVER === "s3" ? new S3Driver() : new LocalDriver(path.resolve(process.env.LOCAL_UPLOAD_DIR ?? "./uploads"));
  }
  return driver;
}

export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Verify the file's magic bytes match the declared type (don't trust the client's Content-Type). */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.length >= 5 && buf.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return null;
}

export function newStorageKey(branchId: string, mime: string) {
  const d = new Date();
  return `${branchId}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ALLOWED_UPLOAD_TYPES[mime]}`;
}

export const sha256Hex = (b: Buffer) => createHash("sha256").update(b).digest("hex");
