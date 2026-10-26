import { api } from "@/lib/api";
import { issueInput, issuePart } from "@/lib/services/service/parts";

export const POST = api({ body: issueInput }, ({ actor, body, params }) => issuePart(actor, params.id, body));
