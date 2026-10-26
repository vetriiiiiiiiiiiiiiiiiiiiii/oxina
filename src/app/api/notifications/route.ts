import { z } from "zod";
import { api } from "@/lib/api";
import { listNotifications, markNotificationsRead, unreadCount } from "@/lib/services/misc";

export const GET = api({ auth: "any", query: z.object({ unread: z.coerce.boolean().optional() }) }, async ({ actor, query }) => ({ items: await listNotifications(actor, query.unread), unread: await unreadCount(actor) }));
export const POST = api({ auth: "any", body: z.object({ ids: z.array(z.string().uuid()).max(200).optional() }) }, async ({ actor, body }) => {
  await markNotificationsRead(actor, body.ids);
  return { ok: true };
});
