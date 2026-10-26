import { api } from "@/lib/api";
import { createFileLink } from "@/lib/services/files";

export const POST = api({ auth: "any" }, ({ actor, params }) => createFileLink(actor, params.id));
