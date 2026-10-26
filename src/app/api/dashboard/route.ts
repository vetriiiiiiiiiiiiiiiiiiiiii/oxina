import { api } from "@/lib/api";
import { dashboard, rangeQuery } from "@/lib/services/reports";

export const GET = api({ query: rangeQuery }, ({ actor, query }) => dashboard(actor, query));
