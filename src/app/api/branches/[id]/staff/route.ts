import { z } from "zod";
import { api } from "@/lib/api";
import { branchStaff } from "@/lib/services/org";

export const GET = api({ query: z.object({ roles: z.string().optional() }) }, ({ actor, query, params }) => branchStaff(actor, params.id, query.roles?.split(",")));
