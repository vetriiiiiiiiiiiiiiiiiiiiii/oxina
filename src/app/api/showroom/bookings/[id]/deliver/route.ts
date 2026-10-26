import { api } from "@/lib/api";
import { deliverBooking, deliveryInput } from "@/lib/services/showroom";

export const POST = api({ body: deliveryInput }, ({ actor, body, params }) => deliverBooking(actor, params.id, body));
