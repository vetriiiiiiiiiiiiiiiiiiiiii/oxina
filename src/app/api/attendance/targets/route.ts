import { api } from "@/lib/api";
import { setTarget, targetInput } from "@/lib/services/people";

export const POST = api({ body: targetInput }, ({ actor, body }) => setTarget(actor, body));
