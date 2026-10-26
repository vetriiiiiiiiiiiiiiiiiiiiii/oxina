import { api } from "@/lib/api";
import { confirmPayment } from "@/lib/services/billing";

export const POST = api({}, ({ actor, params }) => confirmPayment(actor, params.id));
