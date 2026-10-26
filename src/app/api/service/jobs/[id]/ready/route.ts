import { z } from "zod";
import { api } from "@/lib/api";
import { markReadyForDelivery } from "@/lib/services/service/delivery";

export const POST = api({ body: z.object({ pickupInstructions: z.string().trim().max(500).optional() }) }, ({ actor, body, params }) => markReadyForDelivery(actor, params.id, body.pickupInstructions));
