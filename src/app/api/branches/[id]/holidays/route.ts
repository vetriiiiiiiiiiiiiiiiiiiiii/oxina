import { api } from "@/lib/api";
import { addHoliday, holidayInput } from "@/lib/services/org";

export const POST = api({ body: holidayInput }, ({ actor, body, params }) => addHoliday(actor, params.id, body));
