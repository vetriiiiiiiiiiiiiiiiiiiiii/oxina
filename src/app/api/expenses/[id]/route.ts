import { z } from "zod";
import { api } from "@/lib/api";
import { reviewExpense } from "@/lib/services/misc";

export const POST = api({ body: z.object({ approve: z.boolean() }) }, ({ actor, body, params }) => reviewExpense(actor, params.id, body.approve));
