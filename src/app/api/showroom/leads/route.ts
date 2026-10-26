import { z } from "zod";
import { api } from "@/lib/api";
import { createLead, leadInput, listLeads } from "@/lib/services/showroom";

export const GET = api({ query: z.object({ branchId: z.string().uuid().optional(), status: z.string().optional(), mine: z.coerce.boolean().optional() }) }, ({ actor, query }) => listLeads(actor, query));
export const POST = api({ body: leadInput }, ({ actor, body }) => createLead(actor, body));
