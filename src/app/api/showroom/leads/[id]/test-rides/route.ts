import { api } from "@/lib/api";
import { scheduleShowroomTestRide, testRideInput } from "@/lib/services/showroom";

export const POST = api({ body: testRideInput }, ({ actor, body, params }) => scheduleShowroomTestRide(actor, params.id, body));
