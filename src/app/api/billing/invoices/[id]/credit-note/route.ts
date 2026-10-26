import { api } from "@/lib/api";
import { creditNoteInput, issueCreditNote } from "@/lib/services/billing";

export const POST = api({ body: creditNoteInput }, ({ actor, body, params }) => issueCreditNote(actor, params.id, body));
