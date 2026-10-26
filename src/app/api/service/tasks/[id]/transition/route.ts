import { api } from "@/lib/api";
import { transitionInput, transitionTask } from "@/lib/services/service/repairs";

export const POST = api({ body: transitionInput }, ({ actor, body, params }) => transitionTask(actor, params.id, body));
