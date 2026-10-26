import { api } from "@/lib/api";
import { refundInput, requestRefund } from "@/lib/services/billing";

export const POST = api({ body: refundInput }, ({ actor, body, params }) => requestRefund(actor, params.id, body));
