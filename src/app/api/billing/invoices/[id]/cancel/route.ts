import { z } from "zod";
import { api } from "@/lib/api";
import { cancelInvoice } from "@/lib/services/billing";

export const POST = api({ body: z.object({ reason: z.string().trim().min(5).max(500) }) }, ({ actor, body, params }) => cancelInvoice(actor, params.id, body.reason));
