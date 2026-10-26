import { api } from "@/lib/api";
import { createQuotation, quotationInput } from "@/lib/services/showroom";

export const POST = api({ body: quotationInput }, ({ actor, body }) => createQuotation(actor, body));
