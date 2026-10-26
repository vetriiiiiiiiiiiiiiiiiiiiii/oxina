import { api } from "@/lib/api";
import { revealCustomerDocument } from "@/lib/services/customers";

export const POST = api({}, ({ actor, params }) => revealCustomerDocument(actor, params.id));
