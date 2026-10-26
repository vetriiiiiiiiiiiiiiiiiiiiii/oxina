import { api } from "@/lib/api";
import { createTransfer, transferInput } from "@/lib/services/inventory";

export const POST = api({ body: transferInput }, ({ actor, body }) => createTransfer(actor, body));
