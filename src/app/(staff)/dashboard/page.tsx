import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/current";
import { can, managerAreas, type Actor } from "@/lib/rbac/actor";
import { selectedBranchId } from "@/lib/branch-context";
import { dashboard, rangeQuery } from "@/lib/services/reports";
import { attendanceToday } from "@/lib/services/people";
import { mechanicBoard } from "@/lib/services/service/repairs";
import { reorderRecommendations } from "@/lib/services/inventory";
import { prisma } from "@/lib/db";
import { branchFilter } from "@/lib/rbac/actor";
import { attentionList, mechanicLoad, myQueues, partShortages, pipeline, showroomSummary, storesSummary, todayCounts, type QueueJob } from "@/lib/services/workqueues";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { BranchChart, RevenueChart } from "@/components/charts";
import { RangeFilter } from "@/components/shell/range-filter";
import { ActionButton } from "@/components/forms/action-button";
import { AttendanceWidget } from "../attendance/widget";
import { TaskActions } from "../service/[id]/actions";
import { JOB_STATUS_LABEL } from "@/lib/service/stages";
import { PHASES, phaseOf } from "@/lib/service/phase";
import { SegmentBar } from "@/components/visual/segment-bar";
import { cn, etaText, fmtDateTime, fmtElapsed, fmtMinutes, fmtMoney, fmtTime, titleCase } from "@/lib/utils";
import { RegPlate } from "@/components/visual/plate";

export const metadata = { title: "Overview" };

/** Figures sit in one joined block (shared borders) rather than separate cards. */
const STRIP = "grid grid-cols-2 pl-px pt-px md:grid-cols-4 [&>*]:-ml-px [&>*]:-mt-px";

const PIPELINE: [string, string][] = [
  ["RECEIVED", "Received"], ["INSPECTION", "Inspection"], ["AWAITING_APPROVAL", "With customer"], ["APPROVED", "Approved"],
  ["PARTS_PENDING", "Waiting parts"], ["IN_REPAIR", "In repair"], ["QUALITY_CHECK", "Quality check"], ["FINAL_BILLING", "Billing"], ["READY_FOR_DELIVERY", "Ready"],
];

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const actor = await requireStaffPage();
  const sp = await searchParams;
  const branchId = await selectedBranchId(actor);
  const manager = can(actor, "dashboard.group") || can(actor, "dashboard.branch");
  const att = can(actor, "attendance.self") ? await attendanceToday(actor) : null;

  return (
    <>
      <PageHeader
        title={manager ? (actor.allBranches && !branchId ? "Group overview" : "Overview") : "My work"}
        description={manager ? undefined : `${actor.name} · ${fmtDateTime(new Date())}`}
        actions={manager ? <RangeFilter /> : can(actor, "service.job.create") ? <Link href="/service/new"><Button>New job card</Button></Link> : undefined}
      />
      {att && <div className="mb-5"><AttendanceWidget data={JSON.parse(JSON.stringify(att))} /></div>}
      {manager ? <ManagerView actor={actor} branchId={branchId} sp={sp} /> : <FrontLineView actor={actor} branchId={branchId} />}
    </>
  );
}

/* ─────────────────────────── Managers, owners, admins ─────────────────────────── */

async function ManagerView({ actor, branchId, sp }: { actor: Actor; branchId?: string; sp: Record<string, string> }) {
  const group = can(actor, "dashboard.group");
  const area = managerAreas(actor);
  const [data, pipe, attention, load, shortages, today, showroom, stores, low] = await Promise.all([
    dashboard(actor, rangeQuery.parse({ ...sp, branchId })),
    area.workshop ? pipeline(actor, branchId) : null,
    area.workshop ? attentionList(actor, branchId) : [],
    area.workshop ? mechanicLoad(actor, branchId) : [],
    area.workshop || area.stores ? partShortages(actor, branchId) : [],
    area.workshop ? todayCounts(actor, branchId) : null,
    area.showroom ? showroomSummary(actor, branchId) : null,
    area.stores ? storesSummary(actor, branchId) : null,
    area.stores ? reorderRecommendations(actor, branchId) : null,
  ]);
  const k = data.kpis;
  const multiBranch = data.branches.length > 1;
  // Revenue figures only for the areas this person is responsible for.
  const series = data.series.map((d) => ({ date: d.date, sales: area.showroom ? d.sales : 0, service: area.workshop || area.money ? d.service : 0 }));
  const noRevenue = series.every((d) => !d.sales && !d.service);

  const approvals = ([
    ["Purchase orders to approve", data.approvals.purchaseOrders, "/inventory/purchases", can(actor, "purchases.approve")],
    ["Expenses to approve", data.approvals.expenses, "/billing?tab=expenses", can(actor, "expenses.approve")],
    ["Leave requests", data.approvals.leaves, "/attendance", can(actor, "attendance.manage")],
    ["Refunds to approve", data.approvals.refunds, "/billing?tab=refunds", can(actor, "refunds.approve")],
    ["Estimates with customers", data.approvals.estimates, "/service?view=awaiting_approval", area.workshop],
    ["Booking payments to confirm", showroom?.unconfirmedPayments ?? 0, "/billing?tab=payments", area.showroom && can(actor, "payments.confirm")],
  ] as [string, number, string, boolean][]).filter(([, , , show]) => show);

  const figures: React.ReactNode[] = [];
  if (area.showroom) figures.push(<Stat key="s" label="Vehicle sales (period)" value={fmtMoney(k.salesRevenue)} hint={`Today ${fmtMoney(k.todaySales)}`} />);
  if (area.workshop || area.money) figures.push(<Stat key="v" label="Service invoiced (period)" value={fmtMoney(k.serviceRevenue)} hint={`Today ${fmtMoney(k.todayService)}`} />);
  if (area.money) figures.push(<Stat key="u" label="Unpaid invoices" value={fmtMoney(k.outstandingAmount)} hint={`${k.outstandingCount} invoice(s)`} tone={k.outstandingCount ? "warn" : "neutral"} href="/billing?status=OUTSTANDING" />);
  if (area.workshop) figures.push(<Stat key="l" label="Past promised time" value={k.overdueJobs} tone={k.overdueJobs ? "bad" : "neutral"} href="/service?view=overdue" />);
  if (area.stores) figures.push(<Stat key="p" label="Parts at or below minimum" value={k.lowStock} tone={k.lowStock ? "warn" : "neutral"} href="/inventory?lowOnly=true" />);
  if (area.showroom) figures.push(<Stat key="b" label="Bikes in showroom stock" value={k.showroomStock} href="/vehicles" />);
  if (area.people) figures.push(<Stat key="d" label="Staff on duty now" value={`${k.clockedIn} / ${k.activeEmployees}`} href="/attendance" />);
  if (group || can(actor, "warranty.manage")) figures.push(<Stat key="w" label="Warranty claims open" value={k.warrantyPending} href="/warranty" />);

  return (
    <div className="space-y-5">
      {area.workshop && pipe && today && (
        <Card>
          <CardHeader
            title={`Workshop — ${Object.values(pipe).reduce((a, b) => a + b, 0)} open jobs`}
            description={`Today: ${today.received} received · ${today.delivered} delivered · ${today.readyNow} waiting for pickup`}
            action={<Link href="/service" className="text-[13px] text-brand-600 hover:underline">All jobs →</Link>}
          />
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9">
            {PIPELINE.map(([status, label], i) => {
              const n = pipe[status] ?? 0;
              const alarm = n > 0 && (status === "PARTS_PENDING" || status === "AWAITING_APPROVAL");
              return (
                <Link key={status} href={`/service?status=${status}&view=all`} className={cn("border-b border-line border-t-[3px] px-3 py-2.5 hover:bg-shade lg:border-b-0", i > 0 && "border-l")} style={{ borderTopColor: phaseOf(status)?.color }}>
                  <p className="text-[12px] text-muted">{label}</p>
                  <p className={cn("font-mono text-[22px] leading-tight", n === 0 ? "text-faint" : alarm ? (status === "PARTS_PENDING" ? "text-bad-700" : "text-warn-700") : "text-ink")}>{n}</p>
                </Link>
              );
            })}
          </div>
          <div className="border-t border-line px-4 py-3">
            <SegmentBar segments={PHASES.map((ph) => ({ key: ph.key, label: ph.label, color: ph.color, value: ph.statuses.reduce((a, st) => a + (pipe[st] ?? 0), 0), href: `/service?status=${ph.statuses[ph.statuses.length - 1]}&view=all` }))} />
          </div>
        </Card>
      )}

      {showroom && <ShowroomPanel s={showroom} />}

      <div className={cn("grid gap-5", area.workshop && approvals.length && "lg:grid-cols-[1.55fr_1fr]")}>
        {area.workshop && (
          <Card>
            <CardHeader title={`Needs attention${attention.length ? ` (${attention.length})` : ""}`} description="Jobs that won't move without someone acting." />
            {attention.length ? (
              <Table>
                <tbody>
                  {attention.slice(0, 10).map(({ job, reason, tone }) => (
                    <tr key={job.id} className="hover:bg-shade">
                      <Td className="w-40 whitespace-nowrap"><Link href={`/service/${job.id}`} className="font-mono text-[13px] text-brand-700 hover:underline">{job.jobNumber.replace(/^OXI-/, "")}</Link><div className="mt-0.5"><RegPlate reg={job.customerVehicle.registrationNumber} /></div></Td>
                      <Td><p className={cn("text-[13px]", tone === "bad" ? "text-bad-700" : tone === "warn" ? "text-warn-700" : "text-ink")}>{reason}</p><p className="text-[12px] text-muted">{job.customer.fullName} · {job.customer.phone} · advisor {job.serviceAdvisor.name}{multiBranch ? ` · ${job.branch.code}` : ""}</p></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <EmptyState title="Nothing is stuck right now" />}
          </Card>
        )}
        {approvals.length > 0 && (
          <Card>
            <CardHeader title="Waiting for your decision" />
            <ul className="text-sm">
              {approvals.map(([l, n, h]) => (
                <li key={l} className="border-b border-line last:border-0">
                  <Link href={h} className="flex items-center justify-between px-4 py-2 hover:bg-shade">
                    <span className={n ? "text-ink" : "text-muted"}>{l}</span>
                    <span className={cn("font-mono", n ? "font-medium text-warn-700" : "text-faint")}>{n}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {(area.workshop || area.stores) && (
        <div className="grid gap-5 lg:grid-cols-2">
          {area.workshop && load.length > 0 && (
            <Card>
              <CardHeader title="Mechanics" description="What each technician is on now and what is lined up." action={<Link href="/service/board" className="text-[13px] text-brand-600 hover:underline">Workshop board →</Link>} />
              <Table>
                <thead><tr><Th>Name</Th><Th>Working on</Th><Th className="text-right">Queued</Th><Th className="text-right">Load</Th></tr></thead>
                <tbody>
                  {load.map((m) => (
                    <tr key={m.id}>
                      <Td className="whitespace-nowrap">{m.name}</Td>
                      <Td className="text-[13px]">{m.current ? <><Link href={`/service/${m.current.job.id}`} className="text-brand-700 hover:underline">{m.current.title}</Link> <span className="text-muted">· {m.current.job.customerVehicle.registrationNumber}</span></> : <span className="text-faint">Free</span>}{m.blocked > 0 && <span className="ml-2 text-[12px] text-bad-700">{m.blocked} blocked</span>}</Td>
                      <Td className="text-right font-mono">{m.queued}</Td>
                      <Td className="text-right font-mono text-[13px]">{m.queuedMinutes ? fmtMinutes(m.queuedMinutes) : "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
          <Card>
            <CardHeader title="Parts holding up jobs" action={<Link href="/inventory/requests?view=shortages" className="text-[13px] text-brand-600 hover:underline">Shortages →</Link>} />
            {shortages.length ? (
              <Table>
                <thead><tr><Th>Part</Th><Th>Job</Th><Th>Expected</Th></tr></thead>
                <tbody>
                  {shortages.map((r) => (
                    <tr key={r.id}>
                      <Td>{r.item.name} <span className="text-muted">× {r.quantity}</span><div className="font-mono text-[12px] text-faint">{r.item.partNumber}</div></Td>
                      <Td><Link href={`/service/${r.job.id}`} className="font-mono text-[13px] text-brand-700 hover:underline">{r.job.jobNumber.replace(/^OXI-/, "")}</Link></Td>
                      <Td className="text-[13px]">{r.expectedAvailableAt ? fmtDateTime(r.expectedAvailableAt) : <span className="text-bad-700">No date yet</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <EmptyState title="No jobs are waiting on parts" />}
          </Card>
          {stores && low && <StoresPanel s={stores} low={low} />}
        </div>
      )}

      {figures.length > 0 && (
        <section>
          <h2 className="mb-1.5 text-[13px] font-semibold text-muted">Figures — {data.range.from} to {data.range.to}</h2>
          <div className={STRIP}>{figures}</div>
        </section>
      )}

      {(area.showroom || area.workshop || area.money) && (
        <div className={cn("grid gap-5", multiBranch && "lg:grid-cols-2")}>
          <Card>
            <CardHeader title="Invoiced revenue by day" />
            <CardBody>{noRevenue ? <EmptyState title="No invoices finalized in this period" /> : <RevenueChart data={series} />}</CardBody>
          </Card>
          {multiBranch && (
            <Card>
              <CardHeader title="Revenue by branch" />
              <CardBody>{data.branches.some((b) => b.salesRevenue || b.serviceRevenue) ? <BranchChart data={data.branches.filter((b) => b.salesRevenue || b.serviceRevenue)} /> : <EmptyState title="No revenue in this period" />}</CardBody>
            </Card>
          )}
        </div>
      )}

      {multiBranch && (
        <Card>
          <CardHeader title="Branches" description="Open a branch for its own dashboard." />
          <Table>
            <thead><tr><Th>Branch</Th><Th className="text-right">Open jobs</Th><Th className="text-right">Delivered</Th><Th className="text-right">Avg. turnaround</Th><Th className="text-right">Service</Th><Th className="text-right">Vehicle sales</Th></tr></thead>
            <tbody>
              {data.branches.map((b) => (
                <tr key={b.id} className="hover:bg-shade">
                  <Td><Link href={`/businesses/branches/${b.id}`} className="text-brand-700 hover:underline">{b.name}</Link>{!b.isActive && <span className="ml-2 text-[12px] text-faint">inactive</span>}</Td>
                  <Td className="text-right font-mono">{b.openJobs}</Td>
                  <Td className="text-right font-mono">{b.delivered}</Td>
                  <Td className="text-right font-mono">{b.avgTurnaroundHours === null ? "—" : `${b.avgTurnaroundHours} h`}</Td>
                  <Td className="text-right font-mono">{fmtMoney(b.serviceRevenue)}</Td>
                  <Td className="text-right font-mono">{fmtMoney(b.salesRevenue)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {can(actor, "audit.view") && (
        <Card>
          <CardHeader title="Recent changes" action={<Link className="text-[13px] text-brand-600 hover:underline" href="/audit">Audit log →</Link>} />
          {data.recent.length ? (
            <ul className="grid text-[13px] sm:grid-cols-2">
              {data.recent.map((r) => <li key={r.id} className="flex justify-between gap-3 border-b border-line px-4 py-1.5"><span><span className="text-ink">{r.actor}</span> <span className="text-muted">{titleCase(r.action.replace(/\./g, " "))}</span></span><span className="whitespace-nowrap font-mono text-[12px] text-faint">{fmtTime(r.at)}</span></li>)}
            </ul>
          ) : <EmptyState title="No recent changes" />}
        </Card>
      )}
    </div>
  );
}

const LEAD_STAGES: [string, string][] = [["NEW", "New"], ["CONTACTED", "Contacted"], ["TEST_RIDE_SCHEDULED", "Test ride booked"], ["QUOTED", "Quoted"]];
const BOOKING_STAGES: [string, string][] = [["RESERVED", "Reserved"], ["CONFIRMED", "Confirmed"], ["FINANCE_PENDING", "Finance"], ["AWAITING_REGISTRATION", "Registration"], ["ACCESSORIES_PENDING", "Accessories"], ["READY_FOR_DELIVERY", "Ready"]];

function ShowroomPanel({ s }: { s: Awaited<ReturnType<typeof showroomSummary>> }) {
  const cells = (rows: [string, string][], counts: Record<string, number>, href: (k: string) => string) =>
    rows.map(([k, l], i) => (
      <Link key={k} href={href(k)} className={cn("border-b border-line px-3 py-2.5 hover:bg-shade lg:border-b-0", i > 0 && "border-l")}>
        <p className="text-[12px] text-muted">{l}</p>
        <p className={cn("font-mono text-[22px] leading-tight", counts[k] ? "text-ink" : "text-faint")}>{counts[k] ?? 0}</p>
      </Link>
    ));
  return (
    <>
      <Card>
        <CardHeader title="Showroom" description={`${Object.values(s.leads).reduce((a, b) => a + b, 0)} open leads · ${Object.values(s.bookings).reduce((a, b) => a + b, 0)} bookings in progress · ${s.stock.AVAILABLE ?? 0} bikes available to sell`} action={<Link href="/showroom" className="text-[13px] text-brand-600 hover:underline">Leads & bookings →</Link>} />
        <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10">
          {cells(LEAD_STAGES, s.leads, (k) => `/showroom?status=${k}`)}
          {cells(BOOKING_STAGES, s.bookings, (k) => `/showroom?tab=bookings&status=${k}`)}
        </div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={`Follow-ups overdue (${s.overdueLeads.length})`} />
          {s.overdueLeads.length ? <ul>{s.overdueLeads.map((l) => (
            <li key={l.id} className="border-b border-line last:border-0"><Link href={`/showroom/leads/${l.id}`} className="flex justify-between gap-3 px-4 py-2 text-[13px] hover:bg-shade"><span>{l.name} <span className="text-muted">· {l.phone} · {l.assignedTo?.name ?? "unassigned"}</span></span><span className="whitespace-nowrap text-bad-700">since {fmtDateTime(l.nextFollowUpAt)}</span></Link></li>
          ))}</ul> : <EmptyState title="No overdue follow-ups" />}
        </Card>
        <Card>
          <CardHeader title={`Ready to deliver (${s.ready.length})`} />
          {s.ready.length ? <ul>{s.ready.map((b) => (
            <li key={b.id} className="border-b border-line last:border-0"><Link href={`/showroom/bookings/${b.id}`} className="flex justify-between gap-3 px-4 py-2 text-[13px] hover:bg-shade"><span><span className="font-mono">{b.bookingNumber}</span> · {b.customer.fullName} · {b.vehicleModel.name}</span><span className="text-muted">{b.deliveryScheduledAt ? fmtDateTime(b.deliveryScheduledAt) : "not scheduled"}</span></Link></li>
          ))}</ul> : <EmptyState title="No deliveries waiting" />}
        </Card>
      </div>
    </>
  );
}

function StoresPanel({ s, low }: { s: Awaited<ReturnType<typeof storesSummary>>; low: Awaited<ReturnType<typeof reorderRecommendations>> }) {
  return (
    <Card>
      <CardHeader title="Stores" description={`${s.toPick} part(s) to pick for the workshop · ${s.transfers} transfer(s) to act on`} action={<Link href="/inventory" className="text-[13px] text-brand-600 hover:underline">Stock →</Link>} />
      <ul className="text-[13px]">
        {s.poToApprove.map((p) => <li key={p.id} className="flex justify-between border-b border-line px-4 py-2"><span>Approve <span className="font-mono">{p.poNumber}</span> · {p.supplier.name}</span><Link href="/inventory/purchases" className="text-brand-600 hover:underline">{fmtMoney(p.totalAmount)} →</Link></li>)}
        {s.poToReceive.map((p) => <li key={p.id} className="flex justify-between border-b border-line px-4 py-2"><span>Receive <span className="font-mono">{p.poNumber}</span> · {p.supplier.name}</span><span className="text-muted">{p.expectedDate ? `due ${fmtDateTime(p.expectedDate)}` : p.status.toLowerCase().replace("_", " ")}</span></li>)}
        {low.slice(0, 6).map((r) => <li key={r.itemId + r.branchId} className="flex justify-between border-b border-line px-4 py-2"><span>Reorder {r.name} <span className="text-muted">({r.available} left)</span></span><span className="font-mono">{r.recommendedQty}</span></li>)}
        {!s.poToApprove.length && !s.poToReceive.length && !low.length && <li className="px-4 py-3 text-muted">Nothing to order or receive.</li>}
      </ul>
    </Card>
  );
}

/* ─────────────────────────── Front-line roles ─────────────────────────── */

function JobRows({ jobs, extra }: { jobs: QueueJob[]; extra?: (j: QueueJob) => React.ReactNode }) {
  return (
    <Table>
      <thead><tr><Th>Job</Th><Th>Vehicle / customer</Th><Th>Status</Th><Th>Due</Th>{extra && <Th />}</tr></thead>
      <tbody>
        {jobs.map((j) => (
          <tr key={j.id} className="hover:bg-shade">
            <Td className="whitespace-nowrap"><Link href={`/service/${j.id}`} className="font-mono text-[13px] text-brand-700 hover:underline">{j.jobNumber.replace(/^OXI-/, "")}</Link></Td>
            <Td><RegPlate reg={j.customerVehicle.registrationNumber} /> <span className="ml-1">{j.customerVehicle.modelName}</span><div className="text-[12px] text-muted">{j.customer.fullName} · {j.customer.phone}</div></Td>
            <Td><StatusBadge status={j.status} label={JOB_STATUS_LABEL[j.status]} /></Td>
            <Td className="text-[13px]">{etaText({ earliest: null, latest: j.etaLatest, confidence: "FIRM" }, j.branch.timezone) ?? <span className="text-faint">not set</span>}</Td>
            {extra && <Td>{extra(j)}</Td>}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

async function FrontLineView({ actor, branchId }: { actor: Actor; branchId?: string }) {
  const stores = can(actor, "inventory.issue");
  const bf = branchFilter(actor, branchId).branchId;
  const [q, attention, tasks, shortages, low, transfers] = await Promise.all([
    myQueues(actor, branchId),
    can(actor, "service.job.create") ? attentionList(actor, branchId, true) : [],
    can(actor, "service.repair.work") ? mechanicBoard(actor, branchId) : null,
    stores ? partShortages(actor, branchId) : null,
    stores ? reorderRecommendations(actor, branchId) : null,
    can(actor, "inventory.transfer")
      ? prisma.stockTransfer.findMany({
          where: { OR: [{ status: { in: ["REQUESTED", "APPROVED"] }, ...(bf ? { fromBranchId: bf } : {}) }, { status: "DISPATCHED", ...(bf ? { toBranchId: bf } : {}) }] },
          select: { id: true, transferNumber: true, status: true, fromBranch: { select: { name: true } }, toBranch: { select: { name: true } } },
          take: 10,
        })
      : null,
  ]);
  const blocks: React.ReactNode[] = [];

  if (tasks) {
    const open = tasks.filter((t) => t.status !== "COMPLETED");
    const doneToday = tasks.filter((t) => t.status === "COMPLETED").length;
    blocks.push(
      <Card key="tasks" className="lg:col-span-2">
        <CardHeader title={`My tasks (${open.length})`} description={`${doneToday} finished in the last 24 hours`} action={<Link className="text-[13px] text-brand-600 hover:underline" href="/service/board">Workshop board →</Link>} />
        {open.length ? (
          <ul>
            {open.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-2.5 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t.title} {t.isSafetyCritical && <Badge tone="bad">safety</Badge>} {t.reworkCount > 0 && <Badge tone="warn">rework</Badge>}</p>
                  <p className="text-[12px] text-muted"><Link href={`/service/${t.job.id}`} className="font-mono text-brand-700 hover:underline">{t.job.jobNumber.replace(/^OXI-/, "")}</Link> · {t.job.customerVehicle.modelName} {t.job.customerVehicle.registrationNumber} · {fmtMinutes(t.estimatedMinMinutes)}–{fmtMinutes(t.estimatedMaxMinutes)}</p>
                  <div className="mt-0.5"><StatusBadge status={t.status} />{t.holdReason && <span className="ml-2 text-[12px] text-warn-700">{t.holdReason}</span>}</div>
                </div>
                <TaskActions task={{ id: t.id, status: t.status, version: t.version, mechanicId: t.assignedMechanicId, holdReason: t.holdReason }} mechanics={[]} canAssign={false} isMine={t.assignedMechanicId === actor.userId} canWork />
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No tasks assigned to you" />}
      </Card>,
    );
  }

  if (q.myJobs) {
    blocks.push(
      <Card key="myjobs" className="lg:col-span-2">
        <CardHeader title={`My open jobs (${q.myJobs.length})`} action={<Link href="/service" className="text-[13px] text-brand-600 hover:underline">All jobs →</Link>} />
        {q.myJobs.length ? <JobRows jobs={q.myJobs} /> : <EmptyState title="You have no open jobs" />}
      </Card>,
      <Card key="attention" className="lg:col-span-2">
        <CardHeader title={`Follow up now${attention.length ? ` (${attention.length})` : ""}`} />
        {attention.length ? (
          <ul>{attention.map(({ job, reason, tone }) => (
            <li key={job.id} className="border-b border-line px-4 py-2 last:border-0 text-[13px]">
              <Link href={`/service/${job.id}`} className="font-mono text-brand-700 hover:underline">{job.jobNumber.replace(/^OXI-/, "")}</Link> <span className="text-muted">{job.customer.fullName} · {job.customer.phone}</span>
              <p className={tone === "bad" ? "text-bad-700" : tone === "warn" ? "text-warn-700" : "text-ink"}>{reason}</p>
            </li>
          ))}</ul>
        ) : <EmptyState title="Nothing to chase" />}
        {q.followUpsDue ? <CardBody className="border-t border-line text-[13px]"><Link href="/service/followups" className="text-brand-600 hover:underline">{q.followUpsDue} follow-up call(s) due today →</Link></CardBody> : null}
      </Card>,
    );
  }

  if (q.qcDue) {
    blocks.push(
      <Card key="qc" className="lg:col-span-2">
        <CardHeader title={`Ready for quality check (${q.qcDue.length})`} />
        {q.qcDue.length ? <JobRows jobs={q.qcDue} extra={(j) => <Link href={`/service/${j.id}#quality`} className="text-[13px] text-brand-600 hover:underline">Inspect →</Link>} /> : <EmptyState title="No vehicles waiting for QC" />}
      </Card>,
    );
  }

  if (q.billingDue) {
    blocks.push(
      <Card key="billing" className="lg:col-span-2">
        <CardHeader title={`Jobs to invoice (${q.billingDue.length})`} description="Quality check passed — prepare and finalize the invoice." />
        {q.billingDue.length ? (
          <JobRows jobs={q.billingDue} extra={(j) => {
            const inv = (j as QueueJob & { invoices: { id: string; status: string }[] }).invoices[0];
            return inv ? <Link href={`/billing/${inv.id}`} className="text-[13px] text-brand-600 hover:underline">{inv.status === "DRAFT" ? "Draft — finalize →" : "Open invoice →"}</Link> : <ActionButton size="sm" url={`/api/service/jobs/${j.id}/invoice`} success="Draft invoice prepared.">Prepare invoice</ActionButton>;
          }} />
        ) : <EmptyState title="Nothing to invoice" />}
      </Card>,
    );
  }

  if (q.paymentsToConfirm) {
    blocks.push(
      <Card key="pay">
        <CardHeader title={`Payments to confirm (${q.paymentsToConfirm.length})`} description="A payment only counts once someone confirms the money arrived." />
        {q.paymentsToConfirm.length ? (
          <ul>{q.paymentsToConfirm.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 last:border-0 text-[13px]">
              <span><span className="font-mono">{fmtMoney(p.amount)}</span> · {p.method.toLowerCase()} {p.reference && <span className="text-muted">({p.reference})</span>}<br /><span className="text-muted">{p.customer.fullName}{p.invoice ? ` · ${p.invoice.invoiceNumber}` : ""}</span></span>
              <ActionButton size="sm" variant="success" url={`/api/payments/${p.id}/confirm`} success="Payment confirmed; receipt issued.">Confirm</ActionButton>
            </li>
          ))}</ul>
        ) : <EmptyState title="None waiting" />}
      </Card>,
    );
  }

  if (q.pickQueue) {
    blocks.push(
      <Card key="pick" className="lg:col-span-2">
        <CardHeader title={`Parts to pick and issue (${q.pickQueue.length})`} action={<Link className="text-[13px] text-brand-600 hover:underline" href="/inventory/requests">Open queue →</Link>} />
        {q.pickQueue.length ? (
          <Table>
            <thead><tr><Th>Part</Th><Th>Bin</Th><Th>Job</Th><Th>For</Th><Th>Status</Th><Th>Waiting</Th></tr></thead>
            <tbody>{q.pickQueue.map((r) => (
              <tr key={r.id}>
                <Td>{r.item.name} <span className="text-muted">× {r.quantity}</span>{r.priority !== "NORMAL" && <span className="ml-2 text-[12px] text-bad-700">{r.priority.toLowerCase()}</span>}<div className="font-mono text-[12px] text-faint">{r.item.partNumber}</div></Td>
                <Td className="font-mono text-[13px]">{r.location.code}</Td>
                <Td><Link href={`/service/${r.job.id}`} className="font-mono text-[13px] text-brand-700 hover:underline">{r.job.jobNumber.replace(/^OXI-/, "")}</Link></Td>
                <Td className="text-[13px]">{r.assignedMechanic?.name ?? "—"}</Td>
                <Td><StatusBadge status={r.status} /></Td>
                <Td className="font-mono text-[13px]">{fmtElapsed(Math.round((Date.now() - r.createdAt.getTime()) / 60_000))}</Td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="Nothing to pick" />}
      </Card>,
    );
  }

  if (shortages) {
    blocks.push(
      <Card key="short">
        <CardHeader title={`Missing parts to chase (${shortages.length})`} description="The customer's completion time depends on the arrival date you record." />
        {shortages.length ? <ul>{shortages.map((r) => (
          <li key={r.id} className="flex justify-between gap-3 border-b border-line px-4 py-2 text-[13px] last:border-0">
            <span>{r.item.name} × {r.quantity} <span className="text-muted">for</span> <Link href={`/service/${r.job.id}`} className="font-mono text-brand-700 hover:underline">{r.job.jobNumber.replace(/^OXI-/, "")}</Link></span>
            {r.expectedAvailableAt ? <span className="whitespace-nowrap text-muted">due {fmtDateTime(r.expectedAvailableAt)}</span> : <Link href="/inventory/requests?view=shortages" className="whitespace-nowrap text-bad-700 hover:underline">record date →</Link>}
          </li>
        ))}</ul> : <EmptyState title="Nothing missing" />}
      </Card>,
    );
  }
  if (low) {
    blocks.push(
      <Card key="low">
        <CardHeader title={`To reorder (${low.length})`} action={<Link href="/inventory/purchases" className="text-[13px] text-brand-600 hover:underline">Raise PO →</Link>} />
        {low.length ? <ul>{low.slice(0, 10).map((r) => (
          <li key={r.itemId + r.branchId} className="flex justify-between gap-3 border-b border-line px-4 py-2 text-[13px] last:border-0">
            <span>{r.name} <span className="font-mono text-[12px] text-faint">{r.partNumber}</span><br /><span className="text-muted">{r.available} left · min {r.min}{r.onOrder ? ` · ${r.onOrder} on order` : ""}</span></span>
            <span className="whitespace-nowrap font-mono">order {r.recommendedQty}</span>
          </li>
        ))}</ul> : <EmptyState title="Stock levels are fine" />}
      </Card>,
    );
  }
  if (transfers && transfers.length) {
    blocks.push(
      <Card key="trf" className="lg:col-span-2">
        <CardHeader title={`Transfers waiting on you (${transfers.length})`} action={<Link href="/inventory/transfers" className="text-[13px] text-brand-600 hover:underline">Transfers →</Link>} />
        <ul>{transfers.map((t) => <li key={t.id} className="flex justify-between border-b border-line px-4 py-2 text-[13px] last:border-0"><span className="font-mono">{t.transferNumber}</span><span className="text-muted">{t.fromBranch.name} → {t.toBranch.name}</span><StatusBadge status={t.status} label={t.status === "DISPATCHED" ? "arriving — confirm receipt" : t.status === "REQUESTED" ? "to approve" : "to dispatch"} /></li>)}</ul>
      </Card>,
    );
  }

  if (q.leadsDue) {
    blocks.push(
      <Card key="leads">
        <CardHeader title={`Leads to call — next 3 days (${q.leadsDue.length})`} action={<Link className="text-[13px] text-brand-600 hover:underline" href="/showroom">Showroom →</Link>} />
        {q.leadsDue.length ? <ul>{q.leadsDue.map((l) => {
          const overdue = l.nextFollowUpAt && l.nextFollowUpAt < new Date();
          return <li key={l.id} className="border-b border-line last:border-0"><Link href={`/showroom/leads/${l.id}`} className="flex justify-between gap-3 px-4 py-2 text-[13px] hover:bg-shade"><span>{l.name} <span className="text-muted">· {l.phone} · {l.interestedModel?.name ?? "model not chosen"}</span></span><span className={overdue ? "text-bad-700" : "text-muted"}>{l.nextFollowUpAt ? (overdue ? `overdue since ${fmtDateTime(l.nextFollowUpAt)}` : fmtDateTime(l.nextFollowUpAt)) : "not contacted"}</span></Link></li>;
        })}</ul> : <EmptyState title="No calls due" />}
      </Card>,
    );
  }
  if (q.testRidesToday) {
    blocks.push(
      <Card key="rides">
        <CardHeader title={`Test rides today (${q.testRidesToday.length})`} />
        {q.testRidesToday.length ? <ul>{q.testRidesToday.map((r) => <li key={r.id} className="border-b border-line last:border-0"><Link href={`/showroom/leads/${r.lead.id}`} className="flex justify-between px-4 py-2 text-[13px] hover:bg-shade"><span>{r.lead.name} · {r.vehicleModel.name}</span><span className="font-mono">{fmtTime(r.scheduledAt)}</span></Link></li>)}</ul> : <EmptyState title="None booked for today" />}
      </Card>,
    );
  }

  if (q.myBookings) {
    blocks.push(
      <Card key="bookings" className="lg:col-span-2">
        <CardHeader title={`My open bookings (${q.myBookings.length})`} action={<Link href="/showroom?tab=bookings" className="text-[13px] text-brand-600 hover:underline">All bookings →</Link>} />
        {q.myBookings.length ? (
          <Table>
            <thead><tr><Th>Booking</Th><Th>Customer</Th><Th>Model</Th><Th>Status</Th><Th className="text-right">Total</Th><Th>Delivery</Th></tr></thead>
            <tbody>{q.myBookings.map((b) => (
              <tr key={b.id} className="hover:bg-shade">
                <Td><Link href={`/showroom/bookings/${b.id}`} className="font-mono text-[13px] text-brand-700 hover:underline">{b.bookingNumber}</Link></Td>
                <Td className="text-[13px]">{b.customer.fullName}</Td>
                <Td className="text-[13px]">{b.vehicleModel.name}</Td>
                <Td><StatusBadge status={b.status} /></Td>
                <Td className="text-right font-mono text-[13px]">{fmtMoney(b.totalAmount)}</Td>
                <Td className="text-[13px]">{b.deliveryScheduledAt ? fmtDateTime(b.deliveryScheduledAt) : <span className="text-faint">not scheduled</span>}</Td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="No open bookings" />}
      </Card>,
    );
  }

  if (!blocks.length) return <Card><EmptyState title="Nothing assigned to you" description="Use the menu to open your area." /></Card>;
  return <div className="grid gap-5 lg:grid-cols-2">{blocks}</div>;
}
