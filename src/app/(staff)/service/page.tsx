import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/current";
import { can } from "@/lib/rbac/actor";
import { selectedBranchId } from "@/lib/branch-context";
import { listJobs, listJobsQuery } from "@/lib/services/service/intake";
import { Button, Card, EmptyState, Input, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { LinkTabs, Pager } from "@/components/shell/tabs";
import { JOB_STATUS_LABEL } from "@/lib/service/stages";
import { cn, fmtDateTime, fmtMinutes, fmtTime, fmtDate, titleCase } from "@/lib/utils";

export const metadata = { title: "Service jobs" };

/** Who or what the job is waiting on, by status. */
const WITH: Record<string, string> = {
  RECEIVED: "Inspection", INSPECTION: "Inspection report", AWAITING_APPROVAL: "Customer", APPROVED: "Parts / mechanic",
  PARTS_PENDING: "Parts", IN_REPAIR: "Mechanic", QUALITY_CHECK: "Quality check", FINAL_BILLING: "Billing", READY_FOR_DELIVERY: "Customer pickup",
};

export default async function ServicePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const actor = await requireStaffPage();
  const sp = await searchParams;
  const branchId = await selectedBranchId(actor);
  const q = listJobsQuery.parse({ ...sp, branchId });
  const count = (view: "open" | "awaiting_approval" | "blocked" | "overdue") => listJobs(actor, { ...q, view, status: undefined, page: 1, pageSize: 1 }).then((r) => r.total);
  const [data, nOpen, nApproval, nBlocked, nOverdue] = await Promise.all([listJobs(actor, q), count("open"), count("awaiting_approval"), count("blocked"), count("overdue")]);
  const base = (v: string) => `/service?view=${v}${q.search ? `&search=${encodeURIComponent(q.search)}` : ""}`;
  const now = Date.now();
  return (
    <>
      <PageHeader
        title="Service jobs"
        description={can(actor, "service.view") ? undefined : "Jobs you are assigned to."}
        actions={
          <>
            <Link href="/service/followups"><Button variant="outline">Follow-up calls</Button></Link>
            {can(actor, "service.job.create") && <Link href="/service/new"><Button>New job card</Button></Link>}
          </>
        }
      />
      <LinkTabs
        active={q.status ? "" : q.view}
        tabs={[
          { key: "open", label: "Open", href: base("open"), count: nOpen },
          { key: "awaiting_approval", label: "With customer", href: base("awaiting_approval"), count: nApproval },
          { key: "blocked", label: "Waiting for parts", href: base("blocked"), count: nBlocked },
          { key: "overdue", label: "Late", href: base("overdue"), count: nOverdue },
          { key: "all", label: "All, incl. closed", href: base("all") },
        ]}
      />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <form className="flex gap-2">
          <input type="hidden" name="view" value={q.view} />
          {q.status && <input type="hidden" name="status" value={q.status} />}
          <Input name="search" defaultValue={q.search} placeholder="Job no., registration, customer, phone" className="w-72" />
          <Button variant="outline" type="submit">Search</Button>
        </form>
        {q.status && <p className="text-[13px] text-muted">Only <b className="font-medium text-ink">{JOB_STATUS_LABEL[q.status] ?? q.status}</b> · <Link href="/service" className="text-brand-600 hover:underline">clear</Link></p>}
        <p className="ml-auto text-[13px] text-muted">{data.total} job{data.total === 1 ? "" : "s"}</p>
      </div>
      <Card>
        {data.rows.length ? (
          <Table>
            <thead><tr><Th>Job</Th><Th>Vehicle</Th><Th>Customer</Th><Th>Status</Th><Th>Waiting on</Th><Th className="text-right">In for</Th><Th>Promised</Th><Th>Advisor</Th></tr></thead>
            <tbody>
              {data.rows.map((j) => {
                const tz = j.branch.timezone;
                const late = j.etaLatest && j.etaLatest.getTime() < now && !["READY_FOR_DELIVERY", "DELIVERED", "CLOSED", "CANCELLED"].includes(j.status);
                const sameDay = j.etaLatest && fmtDate(j.etaLatest, tz) === fmtDate(new Date(), tz);
                const closed = ["DELIVERED", "CLOSED", "CANCELLED"].includes(j.status);
                return (
                  <tr key={j.id} className="hover:bg-shade">
                    <Td className="whitespace-nowrap">
                      <Link href={`/service/${j.id}`} className="font-mono text-[13px] text-brand-700 hover:underline">{j.jobNumber.replace(/^OXI-/, "")}</Link>
                      <div className="text-[12px] text-muted">{j.branch.code} · {titleCase(j.serviceType)}{j.isEmergency && <span className="text-bad-700"> · emergency</span>}</div>
                    </Td>
                    <Td className="whitespace-nowrap"><span className="font-mono text-[13px]">{j.customerVehicle.registrationNumber}</span><div className="text-[12px] text-muted">{j.customerVehicle.modelName}</div></Td>
                    <Td className="text-[13px]">{j.customer.fullName}</Td>
                    <Td><StatusBadge status={j.status} label={JOB_STATUS_LABEL[j.status]} />{j._count.partRequests > 0 && <div className="text-[12px] text-bad-700">{j._count.partRequests} part(s) missing</div>}</Td>
                    <Td className="text-[13px] text-muted">{closed ? "—" : WITH[j.status] ?? "—"}</Td>
                    <Td className="whitespace-nowrap text-right font-mono text-[13px]">{closed ? "—" : fmtMinutes(Math.round((now - j.receivedAt.getTime()) / 60_000))}</Td>
                    <Td className={cn("whitespace-nowrap text-[13px]", late && "text-bad-700")}>
                      {closed ? <span className="text-muted">{fmtDate(j.receivedAt, tz)}</span> : j.etaLatest ? <>{sameDay ? `Today ${fmtTime(j.etaLatest, tz)}` : fmtDateTime(j.etaLatest, tz)}{late && " · late"}{j.etaConfidence === "PROVISIONAL" && !late && <span className="text-muted"> (prov.)</span>}</> : <span className="text-faint">to be confirmed</span>}
                    </Td>
                    <Td className="whitespace-nowrap text-[13px]">{j.serviceAdvisor.name}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No jobs here" description={q.view === "open" ? "create a job card when a vehicle arrives" : undefined} action={can(actor, "service.job.create") && q.view === "open" ? <Link href="/service/new"><Button size="sm">New job card</Button></Link> : undefined} />
        )}
        <Pager page={data.page} pageSize={data.pageSize} total={data.total} base={base(q.view) + (q.status ? `&status=${q.status}` : "")} />
      </Card>
    </>
  );
}
