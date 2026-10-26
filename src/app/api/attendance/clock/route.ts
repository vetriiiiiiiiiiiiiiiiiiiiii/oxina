import { z } from "zod";
import { api } from "@/lib/api";
import { clockAction } from "@/lib/services/people";

export const POST = api({ body: z.object({ action: z.enum(["IN", "OUT", "BREAK_START", "BREAK_END"]) }) }, ({ actor, body }) => clockAction(actor, body.action));
