import { api } from "@/lib/api";
import { createSupplier, supplierInput } from "@/lib/services/inventory";

export const POST = api({ body: supplierInput }, ({ actor, body }) => createSupplier(actor, body));
