import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/current";
import { can } from "@/lib/rbac/actor";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getCustomerForActor } from "@/lib/services/customers";
import { accessibleBranches } from "@/lib/services/org";
import { workingBranchId } from "@/lib/branch-context";
import { Card, CardBody, CardHeader, DL, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { SimpleForm } from "@/components/forms/simple-form";
import { JOB_STATUS_LABEL } from "@/lib/service/stages";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/utils";
import { PortalAccess, RevealButton } from "./client";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffPage();
  const id = (await params).id;
  const c = await getCustomerForActor(actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const scope = actor.allBranches ? {} : { branchId: { in: actor.branchIds } };
  const [vehicles, jobs, invoices, consents, docs, branches] = await Promise.all([
    prisma.customerVehicle.findMany({ where: { customerId: id } }),
    prisma.serviceJob.findMany({ where: { customerId: id, ...scope }, orderBy: { receivedAt: "desc" }, select: { id: true, jobNumber: true, status: true, receivedAt: true, customerVehicle: { select: { registrationNumber: true } }, branch: { select: { name: true } } } }),
    can(actor, "billing.view") ? prisma.invoice.findMany({ where: { customerId: id, ...scope, status: { not: "DRAFT" } }, orderBy: { createdAt: "desc" } }) : [],
    prisma.customerConsent.findMany({ where: { customerId: id }, orderBy: { grantedAt: "desc" } }),
    can(actor, "customers.sensitive.view") ? prisma.customerDocument.findMany({ where: { customerId: id, ...scope }, select: { id: true, documentType: true, identifierMasked: true, purpose: true, createdAt: true, retainUntil: true } }) : null,
    accessibleBranches(actor),
  ]);
  const wb = await workingBranchId(actor, branches);
  return (
    <>
      <PageHeader eyebrow={<Link href="/customers">Customers</Link>} title={c.fullName} description={`${c.customerCode} · ${c.phone}${c.email ? ` · ${c.email}` : ""}`}
        actions={can(actor, "customers.manage") && (
          <>
            <Modal trigger="Edit" title="Edit customer"><SimpleForm url={`/api/customers/${c.id}`} method="PATCH" fields={[{ name: "fullName", label: "Full name", required: true, defaultValue: c.fullName }, { name: "phone", label: "Mobile", required: true, defaultValue: c.phone }, { name: "email", label: "Email", type: "email", defaultValue: c.email ?? "" }, { name: "city", label: "City", defaultValue: c.city ?? "" }, { name: "stateCode", label: "GST state code", defaultValue: c.stateCode ?? "" }, { name: "addressLine", label: "Address", type: "textarea", defaultValue: c.addressLine ?? "" }]} /></Modal>
            <PortalAccess customerId={c.id} hasAccount={!!c.userId} />
          </>
        )} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Profile" /><CardBody><DL items={[["Address", [c.addressLine, c.city, c.postalCode].filter(Boolean).join(", ") || "—"], ["GST state", c.stateCode ?? "—"], ["Portal account", c.userId ? "Active" : "Not set up"], ["Registered", fmtDate(c.createdAt)], ["Consents", consents.map((k) => `${k.purpose.toLowerCase().replace(/_/g, " ")}: ${k.granted && !k.revokedAt ? "granted" : "not granted"} (v${k.noticeVersion})`).join("; ") || "—"]]} /></CardBody></Card>
        <Card><CardHeader title="Vehicles" />{vehicles.length ? <ul className="divide-y divide-line text-sm">{vehicles.map((v) => <li key={v.id} className="px-5 py-3">{v.modelName} · <b>{v.registrationNumber}</b><div className="text-xs text-muted">{v.vin ? `VIN ${v.vin} · ` : ""}last odometer {v.lastOdometer ?? "—"} km</div></li>)}</ul> : <EmptyState title="No vehicles" />}</Card>
        <Card><CardHeader title="Service history" />{jobs.length ? <ul className="divide-y divide-line text-sm">{jobs.map((j) => <li key={j.id}><Link href={`/service/${j.id}`} className="flex justify-between gap-2 px-5 py-3 hover:bg-canvas"><span><span className="font-mono">{j.jobNumber}</span><span className="block text-xs text-muted">{j.customerVehicle.registrationNumber} · {j.branch.name} · {fmtDateTime(j.receivedAt)}</span></span><StatusBadge status={j.status} label={JOB_STATUS_LABEL[j.status]} /></Link></li>)}</ul> : <EmptyState title="No service visits in your branches" />}</Card>
        {can(actor, "billing.view") && <Card><CardHeader title="Invoices" />{invoices.length ? <ul className="divide-y divide-line text-sm">{invoices.map((i) => <li key={i.id}><Link href={`/billing/${i.id}`} className="flex justify-between px-5 py-3 hover:bg-canvas"><span className="font-mono">{i.invoiceNumber}</span><span>{fmtMoney(i.grandTotal)} <StatusBadge status={i.status} /></span></Link></li>)}</ul> : <EmptyState title="No invoices" />}</Card>}
        {docs && (
          <Card className="lg:col-span-2">
            <CardHeader title="Identity documents (optional)" description="Not required for ordinary servicing. Collect only with a stated purpose. Identifiers are encrypted; reveals are audited."
              action={wb && <Modal trigger="Add document" title="Add identity document" description="Record why this document is needed."><SimpleForm url={`/api/customers/${c.id}/documents`} fixed={{ branchId: wb }} successMessage="Document recorded (identifier encrypted)." fields={[{ name: "documentType", label: "Type", type: "select", required: true, options: ["DRIVING_LICENCE", "RC", "INSURANCE", "PAN", "AADHAAR", "OTHER"].map((d) => ({ value: d, label: d.replace("_", " ").toLowerCase() })) }, { name: "identifier", label: "Document number" }, { name: "purpose", label: "Purpose", required: true, placeholder: "e.g. vehicle registration for booking BKG-…" }, { name: "retainUntil", label: "Retain until", type: "date" }]} /></Modal>} />
            {docs.length ? <ul className="divide-y divide-line text-sm">{docs.map((d) => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"><span>{d.documentType.replace("_", " ").toLowerCase()} · <span className="font-mono">{d.identifierMasked ?? "—"}</span><span className="block text-xs text-muted">{d.purpose} · added {fmtDate(d.createdAt)}{d.retainUntil ? ` · retain until ${fmtDate(d.retainUntil)}` : ""}</span></span>{d.identifierMasked && <RevealButton documentId={d.id} />}</li>)}</ul> : <EmptyState title="No documents on file" />}
          </Card>
        )}
      </div>
    </>
  );
}
