import { api } from "@/lib/api";
import { assignMechanicInput, assignTaskMechanic } from "@/lib/services/service/repairs";

export const POST = api({ body: assignMechanicInput }, ({ actor, body, params }) => assignTaskMechanic(actor, params.id, body));
