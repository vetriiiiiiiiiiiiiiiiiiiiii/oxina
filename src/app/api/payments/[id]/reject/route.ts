import { z } from "zod";
import { api } from "@/lib/api";
import { rejectPayment } from "@/lib/services/billing";

export const POST = api({ body: z.object({ reason: z.string().trim().min(3).max(300) }) }, ({ actor, body, params }) => rejectPayment(actor, params.id, body.reason));
