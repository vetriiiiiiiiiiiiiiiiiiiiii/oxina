import { z } from "zod";
import { api } from "@/lib/api";
import { decideRefund } from "@/lib/services/billing";

export const POST = api({ body: z.object({ approve: z.boolean() }) }, ({ actor, body, params }) => decideRefund(actor, params.id, body.approve));
