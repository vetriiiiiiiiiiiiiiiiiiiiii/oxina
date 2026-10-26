import { prisma } from "@/lib/db";
import { invalid, notFound } from "@/lib/errors";
import { assertBranch, can, type Actor } from "@/lib/rbac/actor";
import { audit } from "@/lib/audit";
import { signFileToken } from "@/lib/crypto";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, newStorageKey, sha256Hex, sniffMime, storage } from "@/lib/storage";

export async function uploadFile(actor: Actor, branchId: string, file: File, sensitive: boolean) {
  if (actor.kind !== "STAFF") throw notFound("Branch");
  assertBranch(actor, branchId, "Branch");
  if (sensitive && !can(actor, "customers.sensitive.view")) throw invalid("You cannot upload sensitive documents.");
  if (file.size > MAX_UPLOAD_BYTES) throw invalid("Files must be 10 MB or smaller.");
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffMime(buf);
  if (!mime || !ALLOWED_UPLOAD_TYPES[mime]) throw invalid("Only JPEG, PNG, WebP images and PDF files are accepted.");
  const key = newStorageKey(branchId, mime);
  await storage().put(key, buf, mime);
  const name = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "upload";
  const row = await prisma.fileObject.create({
    data: { branchId, storageKey: key, originalName: name, mimeType: mime, sizeBytes: buf.length, sha256: sha256Hex(buf), isSensitive: sensitive, uploadedById: actor.userId },
    select: { id: true, originalName: true, mimeType: true, sizeBytes: true },
  });
  await audit(prisma, { actorId: actor.userId, action: "file.upload", entityType: "FileObject", entityId: row.id, branchId, after: { mime, size: buf.length, sensitive } });
  return row;
}

/** Decide whether this actor may read the file. Customers: only customer-visible photos of their own jobs. */
export async function authorizeFile(actor: Actor, fileId: string) {
  const f = await prisma.fileObject.findUnique({ where: { id: fileId }, include: { servicePhotos: { include: { job: { select: { customerId: true } } } } } });
  if (!f) throw notFound("File");
  if (actor.kind === "CUSTOMER") {
    const ok = f.servicePhotos.some((p) => p.customerVisible && p.job.customerId === actor.customerId);
    if (!ok || f.isSensitive) throw notFound("File");
    return f;
  }
  assertBranch(actor, f.branchId, "File");
  if (f.isSensitive && !can(actor, "customers.sensitive.view")) throw notFound("File");
  return f;
}

export async function createFileLink(actor: Actor, fileId: string) {
  const f = await authorizeFile(actor, fileId);
  if (f.isSensitive) await audit(prisma, { actorId: actor.userId, action: "file.sensitive.link", entityType: "FileObject", entityId: f.id, branchId: f.branchId });
  const ttl = 300;
  return { url: `/api/files/${f.id}?token=${signFileToken(f.id, actor.userId, ttl)}`, expiresInSeconds: ttl };
}
