import { api } from "@/lib/api";
import { feedbackInput, submitFeedback } from "@/lib/services/service/delivery";

export const POST = api({ auth: "customer", body: feedbackInput }, ({ actor, body, params }) => submitFeedback(actor, params.id, body));
