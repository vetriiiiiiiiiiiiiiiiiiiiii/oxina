import { api } from "@/lib/api";
import { adjustInput, adjustStock } from "@/lib/services/inventory";

export const POST = api({ body: adjustInput }, ({ actor, body }) => adjustStock(actor, body));
