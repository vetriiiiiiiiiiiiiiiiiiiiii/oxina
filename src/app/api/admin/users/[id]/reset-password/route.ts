import { api } from "@/lib/api";
import { adminResetPassword } from "@/lib/services/org";

export const POST = api({}, ({ actor, params }) => adminResetPassword(actor, params.id));
