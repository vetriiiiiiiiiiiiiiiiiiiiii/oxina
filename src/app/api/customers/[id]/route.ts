import { api } from "@/lib/api";
import { customerInput, getCustomerForActor, updateCustomer } from "@/lib/services/customers";

export const GET = api({ auth: "any" }, ({ actor, params }) => getCustomerForActor(actor, params.id));
export const PATCH = api({ body: customerInput.partial() }, ({ actor, body, params }) => updateCustomer(actor, params.id, body));
