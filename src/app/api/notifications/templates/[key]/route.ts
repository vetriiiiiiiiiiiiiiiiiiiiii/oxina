import { api } from "@/lib/api";
import { templateInput, upsertTemplate } from "@/lib/services/misc";

export const PUT = api({ body: templateInput }, ({ actor, body, params }) => upsertTemplate(actor, params.key, body));
