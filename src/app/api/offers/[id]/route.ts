import { z } from "zod";
import { api } from "@/lib/api";
import { setOfferActive } from "@/lib/services/misc";

export const PATCH = api({ body: z.object({ isActive: z.boolean() }) }, ({ actor, body, params }) => setOfferActive(actor, params.id, body.isActive));
