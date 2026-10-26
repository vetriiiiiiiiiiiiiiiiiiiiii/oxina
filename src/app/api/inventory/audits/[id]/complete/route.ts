import { api } from "@/lib/api";
import { auditCountInput, completeStockAudit } from "@/lib/services/inventory";

export const POST = api({ body: auditCountInput }, ({ actor, body, params }) => completeStockAudit(actor, params.id, body));
