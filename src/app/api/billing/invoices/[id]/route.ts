import { api } from "@/lib/api";
import { getInvoiceForActor } from "@/lib/services/billing";

export const GET = api({ auth: "any" }, ({ actor, params }) => getInvoiceForActor(actor, params.id));
