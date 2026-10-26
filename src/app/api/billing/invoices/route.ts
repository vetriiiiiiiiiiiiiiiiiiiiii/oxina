import { api } from "@/lib/api";
import { invoiceQuery, listInvoices } from "@/lib/services/billing";

export const GET = api({ query: invoiceQuery }, ({ actor, query }) => listInvoices(actor, query));
