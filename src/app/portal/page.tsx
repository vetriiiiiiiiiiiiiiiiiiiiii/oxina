import Link from "next/link";
import { requireCustomerPage } from "@/lib/auth/current";
import { prisma } from "@/lib/db";
import { Card, CardHeader, EmptyState, StatusBadge } from "@/components/ui";
import { JOB_STATUS_LABEL } from "@/lib/service/stages";
import { etaText, fmtDate, fmtMoney } from "@/lib/utils";

export const metadata = { title: "My vehicles" };

export default async function PortalHome() {
  const actor = await requireCustomerPage();
  const customerId = actor.customerId!;
  // Every query is filtered by the signed-in customer's own id.
  const [vehicles, jobs, invoices, bookings, unread] = await Promise.all([
    prisma.customerVehicle.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } }),
    prisma.serviceJob.findMany({ where: { customerId }, orderBy: { receivedAt: "desc" }, take: 30, select: { id: true, jobNumber: true, status: true, receivedAt: true, etaEarliest: true, etaLatest: true, etaConfidence: true, customerVehicleId: true, branch: { select: { name: true, timezone: true } }, customerVehicle: { select: { modelName: true, registrationNumber: true } } } }),
    prisma.invoice.findMany({ where: { customerId, status: { notIn: ["DRAFT", "CANCELLED"] } }, orderBy: { finalizedAt: "desc" }, take: 20, select: { id: true, invoiceNumber: true, status: true, grandTotal: true, balanceDue: true, finalizedAt: true } }),
    prisma.vehicleBooking.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, select: { id: true, bookingNumber: true, status: true, vehicleModel: { select: { name: true, variant: true } } } }),
    prisma.notification.findMany({ where: { userId: actor.userId, readAt: null }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  const active = jobs.filter((j) => !["DELIVERED", "CLOSED", "CANCELLED"].includes(j.status));
  return (
    <div className="space-y-6">
      <div className="border-b border-line pb-3">
        <h1 className="text-[20px] font-semibold">Your vehicles</h1>
        <p className="text-[13px] text-muted">{actor.name} · progress here updates as the workshop records it.</p>
      </div>
      {unread.length > 0 && (
        <Card className="px-4 py-3">
          <p className="mb-1.5 text-[13px] font-semibold">New for you</p>
          <ul className="space-y-1.5 text-sm">{unread.map((n) => <li key={n.id}>{n.link ? <Link className="hover:underline" href={n.link}>{n.title}</Link> : n.title}<span className="block text-xs text-muted">{n.body}</span></li>)}</ul>
        </Card>
      )}
      {active.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[14px] font-semibold">At the service centre now</h2>
          {active.map((j) => (
            <Link key={j.id} href={`/portal/jobs/${j.id}`} className="block">
              <Card className="flex items-center gap-4 px-4 py-3 hover:border-line-strong">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{j.customerVehicle.modelName} <span className="font-mono text-[13px] font-normal text-muted">{j.customerVehicle.registrationNumber}</span></p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted"><StatusBadge status={j.status} label={JOB_STATUS_LABEL[j.status]} /> {j.branch.name}</div>
                  <p className="mt-1 text-xs">{etaText({ earliest: j.etaEarliest, latest: j.etaLatest, confidence: j.etaConfidence }, j.branch.timezone) ? <>Expected: <b>{etaText({ earliest: j.etaEarliest, latest: j.etaLatest, confidence: j.etaConfidence }, j.branch.timezone)}</b></> : j.status === "READY_FOR_DELIVERY" ? <b className="text-ok-700">Ready for collection</b> : <span className="text-muted">Completion time will be confirmed by your advisor</span>}</p>
                </div>
                <span className="text-[13px] text-brand-600">Track →</span>
              </Card>
            </Link>
          ))}
        </section>
      )}
      <Card>
        <CardHeader title="My vehicles" />
        {vehicles.length ? (
          <ul className="divide-y divide-line">
            {vehicles.map((v) => {
              const hist = jobs.filter((j) => j.customerVehicleId === v.id);
              return (
                <li key={v.id} className="px-5 py-3">
                  <p className="text-sm font-medium">{v.modelName} <span className="text-xs text-muted">· {v.registrationNumber}</span></p>
                  {hist.length ? <ul className="mt-1 space-y-0.5 text-xs">{hist.map((j) => <li key={j.id}><Link href={`/portal/jobs/${j.id}`} className="text-brand-700 hover:underline">{j.jobNumber}</Link> · {fmtDate(j.receivedAt)} · {JOB_STATUS_LABEL[j.status]}</li>)}</ul> : <p className="text-xs text-muted">No service history yet.</p>}
                </li>
              );
            })}
          </ul>
        ) : <EmptyState title="No vehicles registered" />}
      </Card>
      {bookings.length > 0 && <Card><CardHeader title="Vehicle bookings" /><ul className="divide-y divide-line">{bookings.map((b) => <li key={b.id}><Link href={`/portal/bookings/${b.id}`} className="flex justify-between px-5 py-3 text-sm hover:bg-canvas"><span>{b.vehicleModel.name} {b.vehicleModel.variant} <span className="text-xs text-muted">· {b.bookingNumber}</span></span><StatusBadge status={b.status} /></Link></li>)}</ul></Card>}
      <Card>
        <CardHeader title="Invoices" />
        {invoices.length ? <ul className="divide-y divide-line">{invoices.map((i) => <li key={i.id}><Link href={`/portal/invoices/${i.id}`} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-canvas"><span><span className="font-mono">{i.invoiceNumber}</span><span className="block text-xs text-muted">{fmtDate(i.finalizedAt)}</span></span><span className="text-right">{fmtMoney(i.grandTotal)}<span className="block"><StatusBadge status={i.status} /></span></span></Link></li>)}</ul> : <EmptyState title="No invoices yet" />}
      </Card>
    </div>
  );
}
