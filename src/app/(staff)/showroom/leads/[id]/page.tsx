import { notFound } from "next/navigation";
import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/current";
import { can } from "@/lib/rbac/actor";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getLead } from "@/lib/services/showroom";
import { Card, CardBody, CardHeader, DL, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { SimpleForm } from "@/components/forms/simple-form";
import { ActionButton } from "@/components/forms/action-button";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/utils";

export const metadata = { title: "Lead" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffPage();
  const lead = await getLead(actor, (await params).id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const [models, vehicles] = await Promise.all([
    prisma.vehicleModel.findMany({ where: { businessUnitId: lead.branch.businessUnitId, isActive: true }, orderBy: { name: "asc" } }),
    prisma.vehicle.findMany({ where: { branchId: lead.branchId, status: "AVAILABLE" }, include: { vehicleModel: true }, orderBy: { receivedAt: "asc" } }),
  ]);
  const modelOpts = models.map((m) => ({ value: m.id, label: `${m.name} ${m.variant}`.trim() }));
  const manage = can(actor, "showroom.leads.manage");
  const pricing = can(actor, "showroom.pricing.approve");
  return (
    <>
      <PageHeader eyebrow={<Link href="/showroom">Showroom</Link>} title={lead.name} description={`${lead.phone}${lead.email ? ` · ${lead.email}` : ""} · ${lead.branch.name}`}
        actions={manage && !["BOOKED", "LOST"].includes(lead.status) && (
          <>
            <Modal trigger="Log contact" title="Log follow-up"><SimpleForm url={`/api/showroom/leads/${lead.id}/activity`} successMessage="Activity logged." fields={[{ name: "type", label: "Type", type: "select", required: true, options: ["CALL", "VISIT", "WHATSAPP", "EMAIL", "NOTE"].map((v) => ({ value: v, label: v.toLowerCase() })) }, { name: "outcome", label: "Outcome" }, { name: "status", label: "Update status", type: "select", options: ["CONTACTED", "QUOTED", "LOST"].map((v) => ({ value: v, label: v.toLowerCase() })) }, { name: "lostReason", label: "Lost reason (if lost)" }, { name: "nextFollowUpAt", label: "Next follow-up", type: "datetime-local" }, { name: "notes", label: "Notes", type: "textarea" }]} /></Modal>
            <Modal trigger="Book test ride" title="Schedule test ride"><SimpleForm url={`/api/showroom/leads/${lead.id}/test-rides`} columns={1} successMessage="Test ride scheduled." fields={[{ name: "vehicleModelId", label: "Model", type: "select", required: true, options: modelOpts, defaultValue: lead.interestedModelId ?? "" }, { name: "scheduledAt", label: "When", type: "datetime-local", required: true }]} /></Modal>
            {can(actor, "showroom.quotations.manage") && <Modal trigger="Quotation" title="Prepare quotation" wide><SimpleForm url="/api/showroom/quotations" fixed={{ leadId: lead.id }} successMessage="Quotation issued." fields={[{ name: "vehicleModelId", label: "Model", type: "select", required: true, options: modelOpts, defaultValue: lead.interestedModelId ?? "" }, { name: "exShowroomPrice", label: "Ex-showroom (₹)", type: "number", required: true }, { name: "insuranceCharges", label: "Insurance (₹)", type: "number" }, { name: "registrationCharges", label: "Registration (₹)", type: "number" }, { name: "accessoriesCharges", label: "Accessories (₹)", type: "number" }, { name: "otherCharges", label: "Other approved charges (₹)", type: "number" }, ...(pricing ? [{ name: "discountAmount", label: "Discount (₹) — manager approval", type: "number" as const }] : []), { name: "validDays", label: "Valid for (days)", type: "number", defaultValue: 7 }]} /></Modal>}
            {can(actor, "showroom.bookings.manage") && <Modal trigger="Create booking" title="Reserve a vehicle" triggerProps={{ variant: "primary" }} wide><SimpleForm url="/api/showroom/bookings" fixed={{ branchId: lead.branchId, leadId: lead.id }} redirectPattern="/showroom/bookings/{id}" successMessage="Booking created; vehicle reserved." fields={[{ name: "vehicleId", label: "Vehicle from stock", type: "select", required: true, options: vehicles.map((v) => ({ value: v.id, label: `${v.vehicleModel.name} ${v.vehicleModel.variant} · ${v.colour} · ${v.vin} · ${fmtMoney(v.onRoadPrice)}` })) }, { name: "vehicleModelId", label: "Model (must match vehicle)", type: "select", required: true, options: modelOpts, defaultValue: lead.interestedModelId ?? "" }, { name: "couponCode", label: "Coupon code" }, ...(pricing ? [{ name: "discountAmount", label: "Manual discount (₹)", type: "number" as const }] : []), { name: "financeStatus", label: "Finance", type: "select", options: ["NOT_REQUIRED", "APPLIED", "APPROVED"].map((v) => ({ value: v, label: v.replace("_", " ").toLowerCase() })), defaultValue: "NOT_REQUIRED" }, { name: "financier", label: "Financier" }]} /></Modal>}
          </>
        )} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          <Card><CardHeader title="Lead" action={<StatusBadge status={lead.status} />} /><CardBody><DL items={[["Interested in", lead.interestedModel ? `${lead.interestedModel.name} ${lead.interestedModel.variant}` : "—"], ["Source", lead.source.toLowerCase()], ["Owner", lead.assignedTo?.name ?? "—"], ["Next follow-up", fmtDateTime(lead.nextFollowUpAt)], ["Lost reason", lead.lostReason ?? "—"], ["Notes", lead.notes ?? "—"]]} /></CardBody></Card>
          <Card><CardHeader title="Test rides" />{lead.testRides.length ? <ul className="divide-y divide-line text-sm">{lead.testRides.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"><span>{r.vehicleModel.name} · {fmtDateTime(r.scheduledAt)}</span><span className="flex items-center gap-2"><StatusBadge status={r.status === "SCHEDULED" ? "PENDING" : r.status === "COMPLETED" ? "COMPLETED" : "CANCELLED"} label={r.status.toLowerCase()} />{r.status === "SCHEDULED" && manage && <><ActionButton size="sm" variant="outline" url={`/api/showroom/test-rides/${r.id}`} body={{ status: "COMPLETED" }} success="Test ride completed.">Done</ActionButton><ActionButton size="sm" variant="ghost" url={`/api/showroom/test-rides/${r.id}`} body={{ status: "NO_SHOW" }} success="Marked no-show.">No-show</ActionButton></>}</span></li>)}</ul> : <EmptyState title="None scheduled" />}</Card>
          <Card><CardHeader title="Quotations" />{lead.quotations.length ? <ul className="divide-y divide-line text-sm">{lead.quotations.map((q) => <li key={q.id} className="px-5 py-3"><span className="font-mono text-xs">{q.quotationNumber}</span> · {q.vehicleModel.name} · <b>{fmtMoney(q.totalAmount)}</b>{Number(q.discountAmount) > 0 && <span className="text-xs text-muted"> (discount {fmtMoney(q.discountAmount)})</span>}<div className="text-xs text-muted">valid until {fmtDate(q.validUntil)}</div></li>)}</ul> : <EmptyState title="No quotations" />}</Card>
        </div>
        <Card><CardHeader title="Contact history" />{lead.activities.length ? <ul className="divide-y divide-line">{lead.activities.map((a) => <li key={a.id} className="px-5 py-3 text-sm"><p><span className="font-medium">{a.type.toLowerCase()}</span>{a.outcome && ` — ${a.outcome}`}</p>{a.notes && <p className="text-muted">{a.notes}</p>}<p className="text-xs text-faint">{fmtDateTime(a.createdAt)}</p></li>)}</ul> : <EmptyState title="No contact yet" />}</Card>
      </div>
    </>
  );
}
