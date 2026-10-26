import { z } from "zod";
import { api } from "@/lib/api";
import { claimInput, createClaim, listClaims } from "@/lib/services/misc";

export const GET = api({ query: z.object({ branchId: z.string().uuid().optional(), status: z.string().optional() }) }, ({ actor, query }) => listClaims(actor, query));
export const POST = api({ body: claimInput }, ({ actor, body }) => createClaim(actor, body));
