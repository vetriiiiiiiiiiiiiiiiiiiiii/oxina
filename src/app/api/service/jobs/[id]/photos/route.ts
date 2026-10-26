import { z } from "zod";
import { api } from "@/lib/api";
import { attachJobPhoto, photoMetaInput } from "@/lib/services/service/delivery";

export const POST = api({ body: photoMetaInput.extend({ fileId: z.string().uuid() }) }, ({ actor, body, params }) => {
  const { fileId, ...meta } = body;
  return attachJobPhoto(actor, params.id, fileId, meta);
});
