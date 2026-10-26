import { api } from "@/lib/api";
import { customerJobView, staffJobDetail } from "@/lib/services/service/delivery";

/** Staff receive the full workspace; customers receive the allow-listed customer view. */
export const GET = api<unknown>({ auth: "any" }, ({ actor, params }) => (actor.kind === "CUSTOMER" ? customerJobView(actor, params.id) : staffJobDetail(actor, params.id)));
