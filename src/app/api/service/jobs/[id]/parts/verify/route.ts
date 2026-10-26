import { api } from "@/lib/api";
import { verifyPartsAndRequest } from "@/lib/services/service/parts";

export const POST = api({}, ({ actor, params }) => verifyPartsAndRequest(actor, params.id));
