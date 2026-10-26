import { z } from "zod";
import { api } from "@/lib/api";
import { sendEstimate } from "@/lib/services/service/inspection";

export const POST = api({ body: z.object({ note: z.string().trim().max(1000).optional() }) }, ({ actor, body, params }) => sendEstimate(actor, params.id, body.note));
