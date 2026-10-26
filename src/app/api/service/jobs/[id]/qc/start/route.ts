import { api } from "@/lib/api";
import { startQualityInspection } from "@/lib/services/service/quality";

export const POST = api({}, ({ actor, params }) => startQualityInspection(actor, params.id));
