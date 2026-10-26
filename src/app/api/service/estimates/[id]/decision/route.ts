import { api } from "@/lib/api";
import { decideEstimate, decisionInput } from "@/lib/services/service/inspection";

/** Customers (own jobs only) or staff recording an in-person/phone decision. */
export const POST = api({ auth: "any", body: decisionInput }, ({ actor, body, params }) => decideEstimate(actor, params.id, body));
