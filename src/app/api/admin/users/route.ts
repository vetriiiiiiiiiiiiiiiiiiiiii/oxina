import { z } from "zod";
import { api } from "@/lib/api";
import { createUser, listUsers, userCreateInput } from "@/lib/services/org";

export const GET = api({ query: z.object({ branchId: z.string().uuid().optional(), search: z.string().max(60).optional() }) }, ({ actor, query }) => listUsers(actor, query));
export const POST = api({ body: userCreateInput }, ({ actor, body }) => createUser(actor, body));
