import { z } from "zod";
import { api } from "@/lib/api";
import { reviewLeave } from "@/lib/services/people";

export const POST = api({ body: z.object({ approve: z.boolean() }) }, ({ actor, body, params }) => reviewLeave(actor, params.id, body.approve));
