import { api } from "@/lib/api";
import { completeQualityInspection, qcCompleteInput } from "@/lib/services/service/quality";

export const POST = api({ body: qcCompleteInput }, ({ actor, body, params }) => completeQualityInspection(actor, params.id, body));
