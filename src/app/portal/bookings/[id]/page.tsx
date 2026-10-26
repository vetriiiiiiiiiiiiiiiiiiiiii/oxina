import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCustomerPage } from "@/lib/auth/current";
import { AppError } from "@/lib/errors";
import { getBooking } from "@/lib/services/showroom";
import { Card, CardBody, CardHeader, DL, StatusBadge } from "@/components/ui";
import { fmtDateTime, fmtMoney, titleCase } from "@/lib/utils";

export const metadata = { title: "My booking" };

const FLOW = ["RESERVED", "CONFIRMED", "FINANCE_PENDING", "AWAITING_REGISTRATION", "ACCESSORIES_PENDING", "READY_FOR_DELIVERY", "DELIVERED"];

export default async function PortalBooking({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireCustomerPage();
  const b = await getBooking(actor, (await params).id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const idx = FLOW.indexOf(b.status);
  const paid = b.payments.filter((p) => p.status === "CONFIRMED").reduce((s, p) => s + Number(p.amount), 0);
  return (
    <div className="space-y-4">
      <Link href="/portal" className="text-xs font-medium text-brand-600">← Back</Link>
      <h1 className="text-xl font-semibold">{b.vehicleModel.name} {b.vehicleModel.variant}</h1>
      <Card>
        <CardHeader title={`Booking ${b.bookingNumber}`} action={<StatusBadge status={b.status} />} />
        <CardBody className="space-y-5">
          {b.status !== "CANCELLED" && (
            <ol className="flex flex-wrap gap-2 text-xs">{FLOW.map((s, i) => <li key={s} className={`rounded-[3px] px-2.5 py-1 ${i < idx ? "bg-ok-50 text-ok-700" : i === idx ? "bg-brand-600 text-white" : "bg-canvas text-faint"}`}>{titleCase(s)}</li>)}</ol>
          )}
          <DL items={[["Branch", b.branch.name], ["Colour / chassis", b.vehicle ? `${b.vehicle.colour} · ${b.vehicle.vin}` : "Allocation pending"], ["Total", fmtMoney(b.totalAmount)], ["Paid (confirmed)", fmtMoney(paid)], ["Finance", titleCase(b.financeStatus)], ["Registration", titleCase(b.registrationStatus)], ["Delivery scheduled", fmtDateTime(b.deliveryScheduledAt)], ["Delivered", fmtDateTime(b.deliveredAt)]]} />
        </CardBody>
      </Card>
    </div>
  );
}
