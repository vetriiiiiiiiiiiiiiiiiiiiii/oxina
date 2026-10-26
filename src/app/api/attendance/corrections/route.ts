import { api } from "@/lib/api";
import { correctionInput, requestCorrection } from "@/lib/services/people";

export const POST = api({ body: correctionInput }, ({ actor, body }) => requestCorrection(actor, body));
