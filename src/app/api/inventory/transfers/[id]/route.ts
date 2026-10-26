import { z } from "zod";
import { api } from "@/lib/api";
import { progressTransfer } from "@/lib/services/inventory";

export const POST = api({ body: z.object({ action: z.enum(["APPROVE", "DISPATCH", "RECEIVE", "CANCEL"]) }) }, ({ actor, body, params }) => progressTransfer(actor, params.id, body.action));
