import { z } from "zod";
import { api } from "@/lib/api";
import { completeShowroomTestRide } from "@/lib/services/showroom";

export const POST = api({ body: z.object({ status: z.enum(["COMPLETED", "NO_SHOW", "CANCELLED"]), feedback: z.string().trim().max(500).optional() }) }, ({ actor, body, params }) => completeShowroomTestRide(actor, params.id, body.status, body.feedback));
