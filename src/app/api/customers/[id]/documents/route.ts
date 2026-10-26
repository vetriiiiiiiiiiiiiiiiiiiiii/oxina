import { z } from "zod";
import { api } from "@/lib/api";
import { addCustomerDocument, documentInput } from "@/lib/services/customers";

export const POST = api({ body: documentInput.extend({ fileId: z.string().uuid().optional() }) }, ({ actor, body, params }) => {
  const { fileId, ...rest } = body;
  return addCustomerDocument(actor, params.id, rest, fileId);
});
