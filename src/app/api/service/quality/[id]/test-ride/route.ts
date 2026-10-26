import { api } from "@/lib/api";
import { startTestRide, testRideStartInput } from "@/lib/services/service/quality";

export const POST = api({ body: testRideStartInput }, ({ actor, body, params }) => startTestRide(actor, params.id, body));
