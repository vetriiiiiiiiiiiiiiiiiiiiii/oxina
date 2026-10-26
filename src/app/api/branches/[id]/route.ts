import { z } from "zod";
import { api } from "@/lib/api";
import { branchInput, getBranch, updateBranch } from "@/lib/services/org";

export const GET = api({}, ({ actor, params }) => getBranch(actor, params.id));
export const PATCH = api({ body: branchInput.partial().extend({ isActive: z.boolean().optional() }) }, ({ actor, body, params }) => updateBranch(actor, params.id, body));
