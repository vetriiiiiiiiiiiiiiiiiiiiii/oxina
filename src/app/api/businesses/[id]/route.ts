import { z } from "zod";
import { api } from "@/lib/api";
import { businessUnitInput, updateBusinessUnit } from "@/lib/services/org";

export const PATCH = api({ body: businessUnitInput.partial().extend({ isActive: z.boolean().optional() }) }, ({ actor, body, params }) => updateBusinessUnit(actor, params.id, body));
