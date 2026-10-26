import { api } from "@/lib/api";
import { createItem, itemInput } from "@/lib/services/inventory";

export const POST = api({ body: itemInput }, ({ actor, body }) => createItem(actor, body));
