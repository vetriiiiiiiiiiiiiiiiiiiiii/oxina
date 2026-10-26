import { api } from "@/lib/api";
import { issuePortalAccess } from "@/lib/services/customers";

export const POST = api({}, ({ actor, params }) => issuePortalAccess(actor, params.id));
