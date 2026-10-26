import { api } from "@/lib/api";
import { completeInspection, inspectionInput } from "@/lib/services/service/inspection";

export const POST = api({ body: inspectionInput }, ({ actor, body, params }) => completeInspection(actor, params.id, body));
