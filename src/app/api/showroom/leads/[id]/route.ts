import { api } from "@/lib/api";
import { getLead } from "@/lib/services/showroom";

export const GET = api({}, ({ actor, params }) => getLead(actor, params.id));
