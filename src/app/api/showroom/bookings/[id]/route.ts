import { api } from "@/lib/api";
import { bookingUpdateInput, getBooking, updateBooking } from "@/lib/services/showroom";

export const GET = api({ auth: "any" }, ({ actor, params }) => getBooking(actor, params.id));
export const PATCH = api({ body: bookingUpdateInput }, ({ actor, body, params }) => updateBooking(actor, params.id, body));
