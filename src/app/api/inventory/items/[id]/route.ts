import { api } from "@/lib/api";
import { itemInput, updateItem } from "@/lib/services/inventory";

export const PATCH = api({ body: itemInput.partial() }, ({ actor, body, params }) => updateItem(actor, params.id, body));
