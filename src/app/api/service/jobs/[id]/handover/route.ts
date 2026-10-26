import { api } from "@/lib/api";
import { handoverInput, handoverVehicle } from "@/lib/services/service/delivery";

export const POST = api({ body: handoverInput }, ({ actor, body, params }) => handoverVehicle(actor, params.id, body));
