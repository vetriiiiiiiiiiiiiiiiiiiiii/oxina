import { api } from "@/lib/api";
import { leadActivityInput, logLeadActivity } from "@/lib/services/showroom";

export const POST = api({ body: leadActivityInput }, ({ actor, body, params }) => logLeadActivity(actor, params.id, body));
