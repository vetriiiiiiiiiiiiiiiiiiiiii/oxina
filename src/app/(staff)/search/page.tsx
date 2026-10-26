import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/current";
import { can } from "@/lib/rbac/actor";
import { listJobs } from "@/lib/services/service/intake";
import { listCustomers } from "@/lib/services/customers";
import { listVehicles } from "@/lib/services/showroom";
import { Card, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";

export const metadata = { title: "Search" };

/** Global search — each section uses the same scoped service queries as its module. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireStaffPage();
  const q = (await searchParams).q?.trim().slice(0, 60) ?? "";
  const canJobs = can(actor, "service.view") || can(actor, "service.view.assigned");
  const [jobs, customers, vehicles] = q.length < 2 ? [null, null, null] : await Promise.all([
    canJobs ? listJobs(actor, { search: q, view: "all", page: 1, pageSize: 10 }) : null,
    can(actor, "customers.view") ? listCustomers(actor, { search: q, pageSize: 10 }) : null,
    can(actor, "vehicles.view") ? listVehicles(actor, { search: q }) : null,
  ]);
  return (
    <>
      <PageHeader title="Search" description={q ? `Results for “${q}” in your authorised branches` : "Type at least 2 characters in the search box."} />
      <div className="grid gap-6 lg:grid-cols-3">
        {jobs && <Card><CardHeader title={`Service jobs (${jobs.total})`} />{jobs.rows.length ? <ul className="divide-y divide-line">{jobs.rows.map((j) => <li key={j.id}><Link href={`/service/${j.id}`} className="flex justify-between gap-2 px-5 py-3 text-sm hover:bg-canvas"><span><span className="font-medium">{j.jobNumber}</span><span className="block text-xs text-muted">{j.customer.fullName} · {j.customerVehicle.registrationNumber}</span></span><StatusBadge status={j.status} /></Link></li>)}</ul> : <EmptyState title="No jobs found" />}</Card>}
        {customers && <Card><CardHeader title={`Customers (${customers.total})`} />{customers.rows.length ? <ul className="divide-y divide-line">{customers.rows.map((c) => <li key={c.id}><Link href={`/customers/${c.id}`} className="block px-5 py-3 text-sm hover:bg-canvas"><span className="font-medium">{c.fullName}</span><span className="block text-xs text-muted">{c.customerCode} · {c.vehicles.map((v) => v.registrationNumber).join(", ") || "no vehicles"}</span></Link></li>)}</ul> : <EmptyState title="No customers found" />}</Card>}
        {vehicles && <Card><CardHeader title={`Showroom vehicles (${vehicles.length})`} />{vehicles.length ? <ul className="divide-y divide-line">{vehicles.slice(0, 10).map((v) => <li key={v.id} className="px-5 py-3 text-sm"><span className="font-medium">{v.vehicleModel.name} {v.vehicleModel.variant}</span><span className="block text-xs text-muted">{v.vin} · {v.colour} · {v.branch.name}</span></li>)}</ul> : <EmptyState title="No vehicles found" />}</Card>}
      </div>
    </>
  );
}
