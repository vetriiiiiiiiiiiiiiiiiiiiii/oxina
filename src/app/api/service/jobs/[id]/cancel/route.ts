import { api } from "@/lib/api";
import { cancelInput, cancelJob } from "@/lib/services/service/intake";

export const POST = api({ body: cancelInput }, ({ actor, body, params }) => cancelJob(actor, params.id, body));
