import { z } from "zod";
import { api } from "@/lib/api";
import { createCustomer, customerInput, listCustomers } from "@/lib/services/customers";

export const GET = api({ query: z.object({ search: z.string().max(60).optional(), page: z.coerce.number().int().min(1).optional() }) }, ({ actor, query }) => listCustomers(actor, query));
export const POST = api({ body: customerInput.extend({ branchId: z.string().uuid() }) }, ({ actor, body }) => {
  const { branchId, ...rest } = body;
  return createCustomer(actor, branchId, rest);
});
