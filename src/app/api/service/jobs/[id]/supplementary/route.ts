import { api } from "@/lib/api";
import { addSupplementaryWork, supplementaryInput } from "@/lib/services/service/inspection";

export const POST = api({ body: supplementaryInput }, ({ actor, body, params }) => addSupplementaryWork(actor, params.id, body));
