import { z } from "zod";
import { api } from "@/lib/api";
import { createEmployee, employeeInput, listEmployees } from "@/lib/services/people";

export const GET = api({ query: z.object({ branchId: z.string().uuid().optional(), search: z.string().max(60).optional() }) }, ({ actor, query }) => listEmployees(actor, query));
export const POST = api({ body: employeeInput }, ({ actor, body }) => createEmployee(actor, body));
