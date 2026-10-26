import { api } from "@/lib/api";
import { branchInput, createBranch } from "@/lib/services/org";

export const POST = api({ body: branchInput }, ({ actor, body }) => createBranch(actor, body));
