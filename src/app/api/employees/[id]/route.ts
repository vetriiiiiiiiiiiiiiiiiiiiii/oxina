import { api } from "@/lib/api";
import { employeeUpdateInput, updateEmployee } from "@/lib/services/people";

export const PATCH = api({ body: employeeUpdateInput }, ({ actor, body, params }) => updateEmployee(actor, params.id, body));
