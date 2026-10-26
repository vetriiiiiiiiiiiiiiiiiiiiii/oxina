import { api } from "@/lib/api";
import { followUpInput, recordFollowUp } from "@/lib/services/service/delivery";

export const POST = api({ body: followUpInput }, ({ actor, body, params }) => recordFollowUp(actor, params.id, body));
