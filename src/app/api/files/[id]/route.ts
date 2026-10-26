import { api } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { verifyFileToken } from "@/lib/crypto";
import { authorizeFile } from "@/lib/services/files";
import { storage } from "@/lib/storage";

/** Download requires BOTH a valid session and an unexpired token bound to that user and file. */
export const GET = api({ auth: "any" }, async ({ actor, params, req }) => {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!verifyFileToken(params.id, actor.userId, token)) throw notFound("File");
  const f = await authorizeFile(actor, params.id);
  const data = await storage().get(f.storageKey);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": f.mimeType,
      "Content-Length": String(data.length),
      "Content-Disposition": `${f.mimeType === "application/pdf" ? "attachment" : "inline"}; filename="${f.originalName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
