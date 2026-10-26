import { z } from "zod";
import { api } from "@/lib/api";
import { startStockAudit } from "@/lib/services/inventory";

export const POST = api({ body: z.object({ locationId: z.string().uuid() }) }, ({ actor, body }) => startStockAudit(actor, body.locationId));
