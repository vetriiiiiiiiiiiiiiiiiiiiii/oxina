import { api } from "@/lib/api";
import { businessUnitInput, createBusinessUnit, listBusinessUnits } from "@/lib/services/org";

export const GET = api({}, ({ actor }) => listBusinessUnits(actor));
export const POST = api({ body: businessUnitInput }, ({ actor, body }) => createBusinessUnit(actor, body));
