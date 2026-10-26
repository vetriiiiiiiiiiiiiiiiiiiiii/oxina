import { z } from "zod";
import { api } from "@/lib/api";
import { reorderRecommendations } from "@/lib/services/inventory";

export const GET = api({ query: z.object({ branchId: z.string().uuid().optional() }) }, ({ actor, query }) => reorderRecommendations(actor, query.branchId));
