import { formatInTimeZone } from "date-fns-tz";
import { requireStaffPage } from "@/lib/auth/current";
import { can } from "@/lib/rbac/actor";
import { prisma } from "@/lib/db";
import { selectedBranchId } from "@/lib/branch-context";
import { attendanceOverview, attendanceToday, performance } from "@/lib/services/people";
import { Badge, Card, CardHeader, EmptyState, Notice, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { SimpleForm } from "@/components/forms/simple-form";
import { ActionButton } from "@/components/forms/action-button";
import { LinkTabs } from "@/components/shell/tabs";
import { fmtDate, fmtMinutes, fmtMoney, fmtTime, titleCase } from "@/lib/utils";
import { AttendanceWidget } from "./widget";

export const metadata = { title: "Attendance & Targets" };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ tab?: string; month?: string }> }) {
  const actor = await requireStaffPage();
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : formatInTimeZone(new Date(), "Asia/Kolkata", "yyyy-MM");
  const tab = sp.tab ?? (can(actor, "attendance.self") || can(actor, "attendance.manage") ? "attendance" : "targets");
  const branchId = await selectedBranchId(actor);
  return (
    <>
      <PageHeader title="Attendance & targets" description={`Month: ${month}`} actions={<form className="flex gap-2"><input type="hidden" name="tab" value={tab} /><input type="month" name="month" defaultValue={month} className="h-9 rounded-[3px] border border-line px-2 text-sm" /><button className="h-9 rounded-[3px] border border-line bg-white px-3 text-sm">Go</button></form>} />
      <Notice tone="warn">Clock-in times are entered by staff in this app. They are not checked by GPS or biometric devices.</Notice>
      <div className="mt-6"><LinkTabs active={tab} tabs={[{ key: "attendance", label: "Attendance & leave", href: `?tab=attendance&month=${month}` }, ...(can(actor, "targets.view") ? [{ key: "targets", label: "Targets & performance", href: `?tab=targets&month=${month}` }] : [])]} /></div>
      {tab === "attendance" ? <Att /> : <Perf />}
    </>
  );

  async function Att() {
    const [today, data] = await Promise.all([can(actor, "attendance.self") ? attendanceToday(actor) : null, attendanceOverview(actor, { branchId, month })]);
    return (
      <div className="space-y-6">
        {today && <AttendanceWidget data={JSON.parse(JSON.stringify(today))} />}
        {can(actor, "attendance.self") && today && (
          <div className="flex gap-2">
            <Modal trigger="Apply for leave" title="Leave application"><SimpleForm url="/api/attendance/leave" successMessage="Leave requested." fields={[{ name: "leaveType", label: "Type", type: "select", required: true, options: ["CASUAL", "SICK", "EARNED", "UNPAID"].map((v) => ({ value: v, label: v.toLowerCase() })) }, { name: "startDate", label: "From", type: "date", required: true }, { name: "endDate", label: "To", type: "date", required: true }, { name: "reason", label: "Reason", type: "textarea", required: true }]} /></Modal>
          </div>
        )}
        {data.manage && data.summary.length > 0 && (
          <Card><CardHeader title="Monthly summary" />
            <Table><thead><tr><Th>Employee</Th><Th className="text-right">Days present</Th><Th className="text-right">Late</Th><Th className="text-right">Early leave</Th><Th className="text-right">Hours</Th></tr></thead>
              <tbody>{data.summary.map((s) => <tr key={s.code}><Td>{s.name}<div className="text-xs text-muted">{s.code}</div></Td><Td className="text-right">{s.days}</Td><Td className="text-right">{s.late}</Td><Td className="text-right">{s.early}</Td><Td className="text-right">{fmtMinutes(s.minutes)}</Td></tr>)}</tbody>
            </Table>
          </Card>
        )}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card><CardHeader title="Leave requests" />{data.leaves.length ? <ul className="divide-y divide-line text-sm">{data.leaves.map((l) => <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"><span>{l.employee.fullName} · {l.leaveType.toLowerCase()} · {fmtDate(l.startDate)}–{fmtDate(l.endDate)}<span className="block text-xs text-muted">{l.reason}</span></span><span className="flex items-center gap-2"><StatusBadge status={l.status} />{l.status === "PENDING" && can(actor, "attendance.manage") && l.employee.userId !== actor.userId && <><ActionButton size="sm" url={`/api/attendance/leave/${l.id}`} body={{ approve: true }} success="Approved.">Approve</ActionButton><ActionButton size="sm" variant="ghost" url={`/api/attendance/leave/${l.id}`} body={{ approve: false }} success="Rejected.">Reject</ActionButton></>}</span></li>)}</ul> : <EmptyState title="No leave requests" />}</Card>
          <Card><CardHeader title="Pending corrections" />{data.corrections.length ? <ul className="divide-y divide-line text-sm">{data.corrections.map((c) => <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"><span>{c.attendance.employee.fullName} · {fmtDate(c.attendance.workDate)}<span className="block text-xs text-muted">{c.reason} · in {fmtTime(c.requestedClockIn)} · out {fmtTime(c.requestedClockOut)}</span></span>{data.manage && c.requestedById !== actor.userId && <span className="flex gap-2"><ActionButton size="sm" url={`/api/attendance/corrections/${c.id}`} body={{ approve: true }} success="Approved.">Approve</ActionButton><ActionButton size="sm" variant="ghost" url={`/api/attendance/corrections/${c.id}`} body={{ approve: false }} success="Rejected.">Reject</ActionButton></span>}</li>)}</ul> : <EmptyState title="No corrections pending" />}</Card>
        </div>
        <Card><CardHeader title="Records" />
          {data.records.length ? (
            <Table><thead><tr><Th>Date</Th><Th>Employee</Th><Th>In</Th><Th>Out</Th><Th>Break</Th><Th>Worked</Th><Th>Flags</Th><Th /></tr></thead>
              <tbody>{data.records.map((r) => (
                <tr key={r.id}><Td className="text-xs">{fmtDate(r.workDate)}</Td><Td>{r.employee.fullName}</Td><Td className="text-xs">{fmtTime(r.clockInAt)}</Td><Td className="text-xs">{fmtTime(r.clockOutAt)}</Td><Td className="text-xs">{fmtMinutes(r.breakMinutes)}</Td><Td className="text-xs">{fmtMinutes(r.workedMinutes)}</Td>
                  <Td className="space-x-1">{r.isLate && <Badge tone="warn">late</Badge>}{r.isEarlyDeparture && <Badge tone="warn">early</Badge>}<Badge>unverified</Badge></Td>
                  <Td>{!data.manage && <Modal trigger="Correction" title="Request correction"><SimpleForm url="/api/attendance/corrections" fixed={{ attendanceId: r.id }} successMessage="Correction requested." fields={[{ name: "requestedClockIn", label: "Correct clock-in", type: "datetime-local" }, { name: "requestedClockOut", label: "Correct clock-out", type: "datetime-local" }, { name: "reason", label: "Reason", type: "textarea", required: true }]} /></Modal>}</Td></tr>
              ))}</tbody>
            </Table>
          ) : <EmptyState title="No attendance records this month" />}
        </Card>
      </div>
    );
  }

  async function Perf() {
    const rows = await performance(actor, { branchId, period: month });
    const employees = can(actor, "targets.manage") ? await prisma.employee.findMany({ where: actor.allBranches ? (branchId ? { branchId } : {}) : { branchId: { in: branchId ? [branchId] : actor.branchIds } }, select: { id: true, fullName: true } }) : [];
    return (
      <Card>
        <CardHeader title="Performance from operational records" description="Sales: delivered bookings & leads. Service: completed tasks, rework, QC and customer ratings. Warehouse: parts issued and fulfilment time."
          action={can(actor, "targets.manage") && <Modal trigger="Set target" title="Set monthly target"><SimpleForm url="/api/attendance/targets" fixed={{ period: month }} fields={[{ name: "employeeId", label: "Employee", type: "select", required: true, options: employees.map((e) => ({ value: e.id, label: e.fullName })) }, { name: "metric", label: "Metric", type: "select", required: true, options: ["VEHICLES_SOLD", "SALES_REVENUE", "LEADS_CONVERTED", "JOBS_COMPLETED", "REQUESTS_FULFILLED"].map((m) => ({ value: m, label: titleCase(m) })) }, { name: "targetValue", label: "Target", type: "number", required: true }]} /></Modal>} />
        {rows.length ? (
          <Table>
            <thead><tr><Th>Employee</Th><Th>Targets</Th><Th>Sales</Th><Th>Service</Th><Th>Warehouse</Th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.employeeId}>
                <Td>{r.name}<div className="text-xs text-muted">{r.code} · {r.branch}</div></Td>
                <Td className="text-xs">{r.targets.length ? r.targets.map((t) => <div key={t.metric}>{titleCase(t.metric)}: {t.metric === "SALES_REVENUE" ? fmtMoney(t.target) : t.target}</div>) : "—"}</Td>
                <Td className="text-xs">{r.sales.vehiclesSold} sold · {fmtMoney(r.sales.revenue)}<br />{r.sales.leadsConverted}/{r.sales.leads} leads converted</Td>
                <Td className="text-xs">{r.service.tasksCompleted} tasks · {r.service.jobsTouched} jobs<br />avg {fmtMinutes(r.service.avgTaskMinutes)} · rework {r.service.reworkTasks}<br />QC {r.service.qcPassed}✓/{r.service.qcFailed}✗ · rating {r.service.avgRating ?? "—"}</Td>
                <Td className="text-xs">{r.warehouse.requestsFulfilled} issued · avg {fmtMinutes(r.warehouse.avgFulfilmentMinutes)}</Td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="No linked employees" />}
      </Card>
    );
  }
}
