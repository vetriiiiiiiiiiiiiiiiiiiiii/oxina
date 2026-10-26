import { api } from "@/lib/api";
import { createPurchaseOrder, poInput } from "@/lib/services/inventory";

export const POST = api({ body: poInput }, ({ actor, body }) => createPurchaseOrder(actor, body));
