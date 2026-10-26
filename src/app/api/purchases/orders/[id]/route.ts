import { z } from "zod";
import { api } from "@/lib/api";
import { setPurchaseOrderStatus } from "@/lib/services/inventory";

export const POST = api({ body: z.object({ status: z.enum(["SUBMITTED", "APPROVED", "CANCELLED"]) }) }, ({ actor, body, params }) => setPurchaseOrderStatus(actor, params.id, body.status));
