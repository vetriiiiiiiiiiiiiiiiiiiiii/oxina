import { api } from "@/lib/api";
import { listStock, stockQuery } from "@/lib/services/inventory";

export const GET = api({ query: stockQuery }, ({ actor, query }) => listStock(actor, query));
