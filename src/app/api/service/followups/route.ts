import { z } from "zod";
import { api } from "@/lib/api";
import { listFollowUps } from "@/lib/services/service/delivery";

export const GET = api({ query: z.object({ branchId: z.string().uuid().optional(), due: z.enum(["today", "overdue", "upcoming"]).optional() }) }, ({ actor, query }) => listFollowUps(actor, query));
