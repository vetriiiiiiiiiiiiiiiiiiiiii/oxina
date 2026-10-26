import { api } from "@/lib/api";
import { applyLeave, leaveInput } from "@/lib/services/people";

export const POST = api({ body: leaveInput }, ({ actor, body }) => applyLeave(actor, body));
