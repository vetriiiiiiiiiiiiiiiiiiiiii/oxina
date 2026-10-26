import { z } from "zod";
import { api } from "@/lib/api";
import { stockMovements } from "@/lib/services/inventory";

export const GET = api({ query: z.object({ branchId: z.string().uuid().optional(), itemId: z.string().uuid().optional() }) }, ({ actor, query }) => stockMovements(actor, query));
