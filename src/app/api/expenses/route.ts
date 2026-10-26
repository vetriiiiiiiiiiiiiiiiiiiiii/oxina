import { z } from "zod";
import { api } from "@/lib/api";
import { expenseInput, listExpenses, submitExpense } from "@/lib/services/misc";

export const GET = api({ query: z.object({ branchId: z.string().uuid().optional() }) }, ({ actor, query }) => listExpenses(actor, query));
export const POST = api({ body: expenseInput }, ({ actor, body }) => submitExpense(actor, body));
