import { api } from "@/lib/api";
import { auditQuery, listAudit } from "@/lib/services/misc";

export const GET = api({ query: auditQuery }, ({ actor, query }) => listAudit(actor, query));
