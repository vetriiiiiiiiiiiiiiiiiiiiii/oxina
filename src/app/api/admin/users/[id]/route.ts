import { api } from "@/lib/api";
import { updateUser, userUpdateInput } from "@/lib/services/org";

export const PATCH = api({ body: userUpdateInput }, ({ actor, body, params }) => updateUser(actor, params.id, body));
