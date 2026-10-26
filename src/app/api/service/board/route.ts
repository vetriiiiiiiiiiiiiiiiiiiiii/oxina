import { z } from "zod";
import { api } from "@/lib/api";
import { mechanicBoard } from "@/lib/services/service/repairs";

export const GET = api({ query: z.object({ branchId: z.string().uuid().optional() }) }, ({ actor, query }) => mechanicBoard(actor, query.branchId));
