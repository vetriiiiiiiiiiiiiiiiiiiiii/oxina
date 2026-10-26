import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/current";
import { can } from "@/lib/rbac/actor";
import { AppError } from "@/lib/errors";
import { getBranch } from "@/lib/services/org";
import { dashboard, rangeQuery } from "@/lib/services/reports";
import { Card, CardBody, CardHeader, DL, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { SimpleForm } from "@/components/forms/simple-form";
import { RangeFilter } from "@/components/shell/range-filter";
import { RevenueChart } from "@/components/charts";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/utils";
import { JOB_STATUS_LABEL } from "@/lib/service/stages";

export const metadata = { title: "Branch" };

/** Detailed operational dashboard for a single branch. */
export default async function BranchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const actor = await requireStaffPage();
  const id = (await params).id;
  const b = await getBranch(actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const d = can(actor, "dashboard.branch") || can(actor, "dashboard.group") ? await dashboard(actor, rangeQuery.parse({ ...(await searchParams), branchId: id })) : null;
  return (
    <>
      <PageHeader eyebrow={<Link href="/businesses">{b.businessUnit.name}</Link>} title={b.name} description={`${b.code} · ${b.city ?? ""} · ${b.workdayStart}–${b.workdayEnd} (${b.timezone})`}
        actions={<>{d && <RangeFilter />}{can(actor, "org.manage") && <Modal trigger="Edit branch" title="Edit branch" wide><SimpleForm url={`/api/branches/${b.id}`} method="PATCH" fields={[{ name: "name", label: "Name", required: true, defaultValue: b.name }, { name: "phone", label: "Phone", defaultValue: b.phone ?? "" }, { name: "email", label: "Email", defaultValue: b.email ?? "" }, { name: "gstin", label: "GSTIN", defaultValue: b.gstin ?? "" }, { name: "stateCode", label: "GST state code", defaultValue: b.stateCode ?? "" }, { name: "workdayStart", label: "Workday start", defaultValue: b.workdayStart }, { name: "workdayEnd", label: "Workday end", defaultValue: b.workdayEnd }, { name: "serviceBays", label: "Service bays", type: "number", defaultValue: b.serviceBays }, { name: "addressLine", label: "Address", type: "textarea", defaultValue: b.addressLine ?? "" }]} /></Modal>}</>} />
      {d && (
        <div className="mb-6 space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Stat label="Jobs in progress" value={d.kpis.jobsInProgress} tone="brand" href="/service" />
            <Stat label="Awaiting approval" value={d.kpis.awaitingApproval} tone={d.kpis.awaitingApproval ? "warn" : "neutral"} />
            <Stat label="Blocked by parts" value={d.kpis.blockedByParts} tone={d.kpis.blockedByParts ? "bad" : "neutral"} />
            <Stat label="Overdue" value={d.kpis.overdueJobs} tone={d.kpis.overdueJobs ? "bad" : "neutral"} />
            <Stat label="Service revenue" value={fmtMoney(d.kpis.serviceRevenue)} />
            <Stat label="Vehicle sales" value={fmtMoney(d.kpis.salesRevenue)} />
            <Stat label="Low stock" value={d.kpis.lowStock} tone={d.kpis.lowStock ? "warn" : "neutral"} />
            <Stat label="Clocked in" value={`${d.kpis.clockedIn}/${d.kpis.activeEmployees}`} />
          </div>
          <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <Card><CardHeader title="Revenue" /><CardBody><RevenueChart data={d.series} /></CardBody></Card>
            <Card><CardHeader title="Open jobs by status" /><ul className="divide-y divide-line text-sm">{d.jobsByStatus.length ? d.jobsByStatus.map((s) => <li key={s.status} className="flex justify-between px-5 py-2.5"><StatusBadge status={s.status} label={JOB_STATUS_LABEL[s.status]} /><span className="tabular-nums">{s.count}</span></li>) : <li className="px-5 py-3 text-muted">No open jobs.</li>}</ul></Card>
          </div>
          {d.delayed.length > 0 && <Card><CardHeader title="Delays" /><ul className="divide-y divide-line text-sm">{d.delayed.map((j) => <li key={j.id}><Link href={`/service/${j.id}`} className="flex justify-between px-5 py-2.5 hover:bg-canvas"><span>{j.jobNumber} · {j.customerVehicle.registrationNumber}</span><span className="text-xs text-muted">due {fmtDateTime(j.etaLatest ?? j.expectedCompletionAt)}</span></Link></li>)}</ul></Card>}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card><CardHeader title="Details" /><CardBody><DL className="sm:grid-cols-1" items={[["Address", [b.addressLine, b.city, b.state, b.postalCode].filter(Boolean).join(", ") || "—"], ["Contact", [b.phone, b.email].filter(Boolean).join(" · ") || "—"], ["GSTIN", b.gstin ?? "—"], ["Working days", b.workingDays.map((d2) => ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d2]).join(", ")], ["Service bays", b.serviceBays]]} /></CardBody></Card>
        <Card><CardHeader title="Stock locations & departments" /><CardBody className="space-y-2 text-sm"><p>{b.locations.map((l) => `${l.code} (${l.type.toLowerCase().replace("_", " ")})`).join(", ")}</p><p className="text-muted">{b.departments.map((x) => x.name).join(", ")}</p></CardBody></Card>
        <Card><CardHeader title="Holidays & closures" description="Excluded from ETA calculations" action={can(actor, "settings.manage") && <Modal trigger="Add" title="Add holiday"><SimpleForm url={`/api/branches/${b.id}/holidays`} columns={1} fields={[{ name: "date", label: "Date", type: "date", required: true }, { name: "name", label: "Name", required: true }]} /></Modal>} />{b.holidays.length ? <ul className="divide-y divide-line text-sm">{b.holidays.map((h) => <li key={h.id} className="px-5 py-2">{fmtDate(h.date)} · {h.name}</li>)}</ul> : <CardBody className="text-sm text-muted">None recorded.</CardBody>}</Card>
      </div>
    </>
  );
}
