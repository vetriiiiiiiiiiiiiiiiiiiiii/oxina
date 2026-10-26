import { api } from "@/lib/api";
import { grnInput, receiveGoods } from "@/lib/services/inventory";

export const POST = api({ body: grnInput }, ({ actor, body }) => receiveGoods(actor, body));
