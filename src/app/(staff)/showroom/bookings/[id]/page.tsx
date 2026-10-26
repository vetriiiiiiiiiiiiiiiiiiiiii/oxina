import { notFound } from "next/navigation";
import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/current";
import { can } from "@/lib/rbac/actor";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getBooking } from "@/lib/services/showroom";
import { Card, CardBody, CardHeader, DL, PageHeader, StatusBadge } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { SimpleForm } from "@/components/forms/simple-form";
import { ActionButton } from "@/components/forms/action-button";
import { fmtDateTime, fmtMoney, titleCase } from "@/lib/utils";

export const metadata = { title: "Booking" };

const NEXT: Record<string, string[]> = {
  RESERVED: ["CONFIRMED"], CONFIRMED: ["FINANCE_PENDING", "AWAITING_REGISTRATION", "ACCESSORIES_PENDING", "READY_FOR_DELIVERY"], FINANCE_PENDING: ["AWAITING_REGISTRATION", "ACCESSORIES_PENDING", "READY_FOR_DELIVERY"],
  AWAITING_REGISTRATION: ["ACCESSORIES_PENDING", "READY_FOR_DELIVERY"], ACCESSORIES_PENDING: ["AWAITING_REGISTRATION", "READY_FOR_DELIVERY"],
};

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffPage();
  const b = await getBooking(actor, (await params).id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const manage = can(actor, "showroom.bookings.manage");
  const paid = b.payments.filter((p) => p.status === "CONFIRMED").reduce((s, p) => s + Number(p.amount), 0);
  const avail = !b.vehicleId ? await prisma.vehicle.findMany({ where: { branchId: b.branchId, vehicleModelId: b.vehicleModelId, status: "AVAILABLE" } }) : [];
  const saleInvoice = b.invoices[0];
  return (
    <>
      <PageHeader eyebrow={<Link href="/showroom?tab=bookings">Bookings</Link>} title={`${b.vehicleModel.name} ${b.vehicleModel.variant}`} description={`${b.bookingNumber} · ${b.customer.fullName} · ${b.branch.name}`}
        actions={manage && !["DELIVERED", "CANCELLED"].includes(b.status) && (
          <>
            {can(actor, "payments.record") && <Modal trigger="Record payment" title="Booking payment" description="Never enter card numbers — use the transaction reference."><SimpleForm url="/api/payments" fixed={{ bookingId: b.id }} successMessage="Payment recorded." fields={[{ name: "amount", label: "Amount (₹)", type: "number", required: true, step: "0.01" }, { name: "method", label: "Method", type: "select", required: true, options: ["CASH", "UPI", "CARD", "BANK_TRANSFER", "CHEQUE", "FINANCE"].map((m) => ({ value: m, label: m.toLowerCase().replace("_", " ") })) }, { name: "reference", label: "Reference" }, ...(can(actor, "payments.confirm") ? [{ name: "confirmNow", label: "Received and verified — confirm now", type: "checkbox" as const, span: 2 as const }] : [])]} /></Modal>}
            <Modal trigger="Update booking" title="Update booking" wide><SimpleForm url={`/api/showroom/bookings/${b.id}`} method="PATCH" successMessage="Booking updated." fields={[{ name: "status", label: "Move to", type: "select", options: [...(NEXT[b.status] ?? []), "CANCELLED"].map((s) => ({ value: s, label: titleCase(s) })) }, ...(avail.length ? [{ name: "vehicleId", label: "Allocate vehicle", type: "select" as const, options: avail.map((v) => ({ value: v.id, label: `${v.colour} · ${v.vin}` })) }] : []), { name: "financeStatus", label: "Finance", type: "select", options: ["NOT_REQUIRED", "APPLIED", "APPROVED", "REJECTED", "DISBURSED"].map((s) => ({ value: s, label: titleCase(s) })) }, { name: "financier", label: "Financier", defaultValue: b.financier ?? "" }, { name: "insuranceProvider", label: "Insurer", defaultValue: b.insuranceProvider ?? "" }, { name: "insurancePolicyNumber", label: "Policy number", defaultValue: b.insurancePolicyNumber ?? "" }, { name: "registrationStatus", label: "Registration", type: "select", options: ["NOT_STARTED", "APPLIED", "COMPLETED"].map((s) => ({ value: s, label: titleCase(s) })) }, { name: "registrationNumber", label: "Registration number" }, { name: "deliveryScheduledAt", label: "Delivery scheduled", type: "datetime-local" }, { name: "cancelReason", label: "Cancellation reason (if cancelling)" }]} /></Modal>
            {b.status === "READY_FOR_DELIVERY" && can(actor, "showroom.pricing.approve") && <Modal trigger="Deliver & finalize sale" title="Delivery checklist" description="Requires full confirmed payment. Creates the sale invoice, the customer's vehicle record and warranty." triggerProps={{ variant: "success" }}><SimpleForm url={`/api/showroom/bookings/${b.id}/deliver`} columns={1} successMessage="Vehicle delivered; sale invoice issued." transform={undefined} fields={[{ name: "checklist.documentsHandedOver", label: "Documents handed over", type: "checkbox" }, { name: "checklist.accessoriesFitted", label: "Accessories fitted", type: "checkbox" }, { name: "checklist.vehicleWalkaround", label: "Vehicle walkaround done", type: "checkbox" }, { name: "checklist.ownersManual", label: "Owner's manual & keys", type: "checkbox" }, { name: "checklist.insuranceCopy", label: "Insurance copy given", type: "checkbox" }, { name: "customerAcknowledged", label: "Customer acknowledges delivery", type: "checkbox" }]} /></Modal>}
          </>
        )} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Booking" action={<StatusBadge status={b.status} />} /><CardBody><DL items={[["Customer", `${b.customer.fullName} · ${b.customer.phone}`], ["Vehicle", b.vehicle ? `${b.vehicle.colour} · ${b.vehicle.vin} · engine ${b.vehicle.engineNumber}` : "Not allocated"], ["Total", fmtMoney(b.totalAmount)], ["Discount", `${fmtMoney(b.discountAmount)}${b.coupon ? ` (coupon ${b.coupon.code})` : ""}`], ["Paid (confirmed)", fmtMoney(paid)], ["Balance", fmtMoney(Number(b.totalAmount) - paid)], ["Finance", `${titleCase(b.financeStatus)}${b.financier ? ` · ${b.financier}` : ""}`], ["Insurance", [b.insuranceProvider, b.insurancePolicyNumber].filter(Boolean).join(" · ") || "—"], ["Registration", titleCase(b.registrationStatus)], ["Delivery", fmtDateTime(b.deliveredAt ?? b.deliveryScheduledAt)]]} /></CardBody></Card>
        <Card><CardHeader title="Payments" />{b.payments.length ? <ul className="divide-y divide-line text-sm">{b.payments.map((p) => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"><span>{fmtMoney(p.amount)} · {p.method.toLowerCase()}{p.reference ? ` · ${p.reference}` : ""}<span className="block text-xs text-muted">{fmtDateTime(p.createdAt)}{p.receiptNumber ? ` · ${p.receiptNumber}` : ""}</span></span><span className="flex items-center gap-2"><StatusBadge status={p.status} />{p.status === "PENDING_CONFIRMATION" && can(actor, "payments.confirm") && <ActionButton size="sm" variant="success" url={`/api/payments/${p.id}/confirm`} success="Confirmed.">Confirm</ActionButton>}</span></li>)}</ul> : <CardBody className="text-sm text-muted">No payments yet. A confirmed booking payment is required to confirm the booking.</CardBody>}
          {saleInvoice && <CardBody className="border-t border-line text-sm">Sale invoice <Link className="font-mono text-brand-700" href={`/billing/${saleInvoice.id}`}>{saleInvoice.invoiceNumber}</Link></CardBody>}
        </Card>
      </div>
    </>
  );
}
