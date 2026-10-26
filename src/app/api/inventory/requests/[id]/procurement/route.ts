import { api } from "@/lib/api";
import { procurementInput, recordProcurement } from "@/lib/services/service/parts";

export const POST = api({ body: procurementInput }, ({ actor, body, params }) => recordProcurement(actor, params.id, body));
