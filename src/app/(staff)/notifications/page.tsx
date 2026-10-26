import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/current";
import { listNotifications } from "@/lib/services/misc";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/forms/action-button";
import { cn, fmtDateTime } from "@/lib/utils";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const actor = await requireStaffPage();
  const items = await listNotifications(actor);
  return (
    <>
      <PageHeader title="Inbox" actions={items.some((i) => !i.readAt) && <ActionButton variant="outline" url="/api/notifications" body={{}} success="All marked read.">Mark all read</ActionButton>} />
      <Card>
        {items.length ? <ul className="divide-y divide-line">{items.map((n) => (
          <li key={n.id} className={cn("flex gap-3 px-5 py-3", !n.readAt && "bg-shade")}>
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-[3px]", n.readAt ? "bg-transparent" : "bg-brand-600")} />
            <div className="min-w-0 flex-1 text-sm">
              {n.link ? <Link href={n.link} className="font-medium hover:underline">{n.title}</Link> : <p className="font-medium">{n.title}</p>}
              {n.body && <p className="text-muted">{n.body}</p>}
              <p className="text-xs text-faint">{fmtDateTime(n.createdAt)}</p>
            </div>
          </li>
        ))}</ul> : <EmptyState title="No messages" />}
      </Card>
    </>
  );
}
