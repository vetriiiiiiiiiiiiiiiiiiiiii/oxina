import { api } from "@/lib/api";
import { lineDiscountInput, updateEstimateLineDiscount } from "@/lib/services/service/inspection";

export const PATCH = api({ body: lineDiscountInput }, ({ actor, body, params }) => updateEstimateLineDiscount(actor, params.id, body));
