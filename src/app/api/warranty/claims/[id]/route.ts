import { api } from "@/lib/api";
import { claimProgressInput, progressClaim } from "@/lib/services/misc";

export const POST = api({ body: claimProgressInput }, ({ actor, body, params }) => progressClaim(actor, params.id, body));
