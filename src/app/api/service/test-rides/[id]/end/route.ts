import { api } from "@/lib/api";
import { endTestRide, testRideEndInput } from "@/lib/services/service/quality";

export const POST = api({ body: testRideEndInput }, ({ actor, body, params }) => endTestRide(actor, params.id, body));
