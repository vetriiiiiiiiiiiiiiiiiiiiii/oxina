import { z } from "zod";
import { api } from "@/lib/api";
import { startInspection } from "@/lib/services/service/inspection";

export const POST = api({ body: z.object({ examinerId: z.string().uuid().optional() }) }, ({ actor, body, params }) => startInspection(actor, params.id, body.examinerId));
