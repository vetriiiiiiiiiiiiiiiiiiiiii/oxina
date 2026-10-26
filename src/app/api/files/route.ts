import { api } from "@/lib/api";
import { invalid } from "@/lib/errors";
import { rateLimit } from "@/lib/auth/rate-limit";
import { uploadFile } from "@/lib/services/files";

export const POST = api({}, async ({ actor, req }) => {
  await rateLimit(`upload:${actor.userId}`, 120, 60 * 60_000);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const branchId = String(form?.get("branchId") ?? "");
  if (!(file instanceof File)) throw invalid("Attach a file.");
  if (!/^[0-9a-f-]{36}$/i.test(branchId)) throw invalid("Missing branch.");
  return uploadFile(actor, branchId, file, form?.get("sensitive") === "true");
});
