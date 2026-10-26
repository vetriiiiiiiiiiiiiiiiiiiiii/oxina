import { api } from "@/lib/api";
import { acknowledgeIntake } from "@/lib/services/service/intake";

export const POST = api({ auth: "any" }, ({ actor, params }) => acknowledgeIntake(actor, params.id));
