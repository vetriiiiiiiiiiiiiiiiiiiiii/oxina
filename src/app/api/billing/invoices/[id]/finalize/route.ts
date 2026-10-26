import { api } from "@/lib/api";
import { finalizeInvoice } from "@/lib/services/billing";

export const POST = api({}, ({ actor, params }) => finalizeInvoice(actor, params.id));
