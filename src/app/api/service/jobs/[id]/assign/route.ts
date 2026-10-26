import { api } from "@/lib/api";
import { assignInput, assignStaff } from "@/lib/services/service/intake";

export const POST = api({ body: assignInput }, ({ actor, body, params }) => assignStaff(actor, params.id, body));
