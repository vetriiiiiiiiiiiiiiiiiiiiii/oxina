import { api } from "@/lib/api";
import { createOffer, listOffers, offerInput } from "@/lib/services/misc";

export const GET = api({}, ({ actor }) => listOffers(actor));
export const POST = api({ body: offerInput }, ({ actor, body }) => createOffer(actor, body));
