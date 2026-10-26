import { api } from "@/lib/api";
import { updateVehiclePricing, vehiclePricingInput } from "@/lib/services/showroom";

export const PUT = api({ body: vehiclePricingInput }, ({ actor, body, params }) => updateVehiclePricing(actor, params.id, body));
