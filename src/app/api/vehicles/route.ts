import { api } from "@/lib/api";
import { addVehicle, listVehicles, vehicleInput, vehicleQuery } from "@/lib/services/showroom";

export const GET = api({ query: vehicleQuery }, ({ actor, query }) => listVehicles(actor, query));
export const POST = api({ body: vehicleInput }, ({ actor, body }) => addVehicle(actor, body));
