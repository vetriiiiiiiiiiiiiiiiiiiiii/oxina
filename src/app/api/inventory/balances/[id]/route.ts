import { api } from "@/lib/api";
import { balanceSettingsInput, updateBalanceSettings } from "@/lib/services/inventory";

export const PATCH = api({ body: balanceSettingsInput }, ({ actor, body, params }) => updateBalanceSettings(actor, params.id, body));
