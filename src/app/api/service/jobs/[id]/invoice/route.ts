import { api } from "@/lib/api";
import { buildServiceInvoice } from "@/lib/services/billing";

export const POST = api({}, ({ actor, params }) => buildServiceInvoice(actor, params.id));
