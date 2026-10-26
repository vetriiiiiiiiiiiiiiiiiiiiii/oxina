import { z } from "zod";
import { api } from "@/lib/api";
import { advancePicking } from "@/lib/services/service/parts";

export const POST = api({ body: z.object({ to: z.enum(["PICKING", "PICKED"]) }) }, ({ actor, body, params }) => advancePicking(actor, params.id, body.to));
