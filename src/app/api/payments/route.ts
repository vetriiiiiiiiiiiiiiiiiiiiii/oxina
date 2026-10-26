import { api } from "@/lib/api";
import { paymentInput, recordPayment } from "@/lib/services/billing";

export const POST = api({ body: paymentInput }, ({ actor, body }) => recordPayment(actor, body));
