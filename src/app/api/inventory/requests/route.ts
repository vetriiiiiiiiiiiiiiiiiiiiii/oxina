import { api } from "@/lib/api";
import { listPartRequests, requestQuery } from "@/lib/services/service/parts";

export const GET = api({ query: requestQuery }, ({ actor, query }) => listPartRequests(actor, query));
