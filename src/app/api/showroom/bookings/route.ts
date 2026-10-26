import { z } from "zod";
import { api } from "@/lib/api";
import { bookingInput, createBooking, listBookings } from "@/lib/services/showroom";

export const GET = api({ query: z.object({ branchId: z.string().uuid().optional(), status: z.string().optional() }) }, ({ actor, query }) => listBookings(actor, query));
export const POST = api({ body: bookingInput }, ({ actor, body }) => createBooking(actor, body));
