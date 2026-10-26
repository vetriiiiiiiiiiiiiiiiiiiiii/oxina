import { z } from "zod";
import { api } from "@/lib/api";
import { reviewCorrection } from "@/lib/services/people";

export const POST = api({ body: z.object({ approve: z.boolean() }) }, ({ actor, body, params }) => reviewCorrection(actor, params.id, body.approve));
