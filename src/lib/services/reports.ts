import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { forbidden, invalid } from "@/lib/errors";
import { branchFilter, can, managerAreas, requirePermission, type Actor } from "@/lib/rbac/actor";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { D, sum } from "@/lib/money";
import { performance } from "./people";

const GROUP_TZ = "Asia/Kolkata";

export const rangeQuery = z.object({
  preset: z.enum(["today", "7d", "30d", "month", "custom"]).default("30d"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  branchId: z.string().uuid().optional(),
  businessUnitId: z.string().uuid().optional(),
});

export type RangeQuery = z.infer<typeof rangeQuery>;

/** Resolve a preset/custom range to [from, to) instants using local (IST) day boundaries. */
export function resolveRange(q: RangeQuery) {
  const today = formatInTimeZone(new Date(), GROUP_TZ, "yyyy-MM-dd");
  const day = (s: string) => fromZonedTime(`${s}T00:00:00`, GROUP_TZ);
  const addDays = (s: string, n: number) => formatInTimeZone(new Date(day(s).getTime() + n * 86400_000 + 12 * 3600_000), GROUP_TZ, "yyyy-MM-dd");
  let fromS = today;
  let toS = addDays(today, 1);
  if (q.preset === "7d") fromS = addDays(today, -6);
  if (q.preset === "30d") fromS = addDays(today, -29);
  if (q.preset === "month") fromS = today.slice(0, 8) + "01";
  if (q.preset === "custom") {
    if (!q.from || !q.to) throw invalid("Choose a start and end date.");
    if (q.to < q.from) throw invalid("End date must be after start date.");
    fromS = q.from;
    toS = addDays(q.to, 1);
  }
  return { from: day(fromS), to: day(toS), fromLabel: fromS, toLabel: addDays(toS, -1) };
}

function scope(actor: Actor, q: RangeQuery): Prisma.BranchWhereInput & { branchId?: unknown } {
  const f = branchFilter(actor, q.branchId);
  return f;
}

async function branchIdsFor(actor: Actor, q: RangeQuery) {
  const where: Prisma.BranchWhereInput = {
    ...(q.branchId ? { id: q.branchId } : actor.allBranches ? {} : { id: { in: actor.branchIds } }),
    ...(q.businessUnitId ? { businessUnitId: q.businessUnitId } : {}),
  };
  if (q.branchId) branchFilter(actor, q.branchId); // asserts scope
  return prisma.branch.findMany({ where, select: { id: true, name: true, code: true, isActive: true, businessUnit: { select: { name: true } } }, orderBy: { name: "asc" } });
}

export async function dashboard(actor: Actor, q: RangeQuery) {
  if (!can(actor, "dashboard.group") && !can(actor, "dashboard.branch")) throw forbidden();
  const { from, to, fromLabel, toLabel } = resolveRange(q);
  const branches = await branchIdsFor(actor, q);
  const ids = branches.map((b) => b.id);
  const inB = { branchId: { in: ids } };
  const now = new Date();
  const today = resolveRange({ preset: "today" });
  const OPEN: Prisma.EnumServiceJobStatusFilter = { notIn: ["DELIVERED", "CLOSED", "CANCELLED"] };

  const [
    units, employees, showroomStock, openJobs, awaitingApproval, blockedJobs, overdueJobs,
    salesInvoices, serviceInvoices, outstanding, balances, clockedIn, claims, todaySales, todayService,
    expensesPending, posPending, leavesPending, refundsPending, recentAudit, delayed, jobsByStatus,
  ] = await Promise.all([
    prisma.businessUnit.count({ where: { isActive: true, branches: { some: { id: { in: ids } } } } }),
    prisma.employee.count({ where: { ...inB, status: "ACTIVE" } }),
    prisma.vehicle.count({ where: { ...inB, status: { in: ["AVAILABLE", "RESERVED", "BOOKING_CONFIRMED", "AWAITING_REGISTRATION", "ACCESSORIES_PENDING", "READY_FOR_DELIVERY"] } } }),
    prisma.serviceJob.count({ where: { ...inB, status: OPEN } }),
    prisma.serviceJob.count({ where: { ...inB, status: "AWAITING_APPROVAL" } }),
    prisma.serviceJob.count({ where: { ...inB, status: OPEN, partRequests: { some: { status: { in: ["UNAVAILABLE", "AWAITING_PROCUREMENT"] } } } } }),
    prisma.serviceJob.count({ where: { ...inB, status: { notIn: ["DELIVERED", "CLOSED", "CANCELLED", "READY_FOR_DELIVERY"] }, OR: [{ etaLatest: { lt: now } }, { etaLatest: null, expectedCompletionAt: { lt: now } }] } }),
    prisma.invoice.findMany({ where: { ...inB, kind: "VEHICLE_SALE", status: { in: ["FINALIZED", "PARTIALLY_PAID", "PAID"] }, finalizedAt: { gte: from, lt: to } }, select: { branchId: true, grandTotal: true, finalizedAt: true } }),
    prisma.invoice.findMany({ where: { ...inB, kind: { in: ["SERVICE", "PARTS_COUNTER"] }, status: { in: ["FINALIZED", "PARTIALLY_PAID", "PAID"] }, finalizedAt: { gte: from, lt: to } }, select: { branchId: true, grandTotal: true, finalizedAt: true } }),
    prisma.invoice.aggregate({ where: { ...inB, status: { in: ["FINALIZED", "PARTIALLY_PAID"] } }, _sum: { balanceDue: true }, _count: true }),
    prisma.inventoryBalance.findMany({ where: { ...inB, item: { isActive: true } }, select: { quantityOnHand: true, quantityReserved: true, minStockLevel: true } }),
    prisma.attendanceRecord.count({ where: { ...inB, workDate: { gte: new Date(today.fromLabel), lte: new Date(today.fromLabel) }, clockInAt: { not: null }, clockOutAt: null } }),
    prisma.warrantyClaim.count({ where: { ...inB, status: { in: ["DRAFT", "SUBMITTED", "UNDER_REVIEW"] } } }),
    prisma.invoice.aggregate({ where: { ...inB, kind: "VEHICLE_SALE", status: { in: ["FINALIZED", "PARTIALLY_PAID", "PAID"] }, finalizedAt: { gte: today.from, lt: today.to } }, _sum: { grandTotal: true } }),
    prisma.invoice.aggregate({ where: { ...inB, kind: { in: ["SERVICE", "PARTS_COUNTER"] }, status: { in: ["FINALIZED", "PARTIALLY_PAID", "PAID"] }, finalizedAt: { gte: today.from, lt: today.to } }, _sum: { grandTotal: true } }),
    prisma.expense.count({ where: { ...inB, status: "PENDING" } }),
    prisma.purchaseOrder.count({ where: { ...inB, status: "SUBMITTED" } }),
    prisma.leaveRequest.count({ where: { ...inB, status: "PENDING" } }),
    prisma.refund.count({ where: { status: "REQUESTED", payment: inB } }),
    prisma.auditLog.findMany({ where: actor.allBranches && !q.branchId ? {} : { branchId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 12, include: { actor: { select: { name: true } } } }),
    prisma.serviceJob.findMany({
      where: { ...inB, status: { notIn: ["DELIVERED", "CLOSED", "CANCELLED", "READY_FOR_DELIVERY"] }, OR: [{ etaLatest: { lt: now } }, { partRequests: { some: { status: { in: ["UNAVAILABLE", "AWAITING_PROCUREMENT"] } } } }, { etaLatest: null, expectedCompletionAt: { lt: now } }] },
      orderBy: { receivedAt: "asc" },
      take: 8,
      select: { id: true, jobNumber: true, status: true, etaLatest: true, expectedCompletionAt: true, receivedAt: true, branch: { select: { name: true } }, customerVehicle: { select: { registrationNumber: true, modelName: true } }, _count: { select: { partRequests: { where: { status: { in: ["UNAVAILABLE", "AWAITING_PROCUREMENT"] } } } } } },
    }),
    prisma.serviceJob.groupBy({ by: ["status"], where: { ...inB, status: OPEN }, _count: true }),
  ]);

  // Daily series
  const days: Record<string, { date: string; sales: number; service: number }> = {};
  for (let t = from.getTime(); t < to.getTime(); t += 86400_000) {
    const d = formatInTimeZone(new Date(t + 3600_000), GROUP_TZ, "yyyy-MM-dd");
    days[d] = { date: d, sales: 0, service: 0 };
  }
  for (const i of salesInvoices) {
    const d = formatInTimeZone(i.finalizedAt!, GROUP_TZ, "yyyy-MM-dd");
    if (days[d]) days[d].sales += Number(i.grandTotal);
  }
  for (const i of serviceInvoices) {
    const d = formatInTimeZone(i.finalizedAt!, GROUP_TZ, "yyyy-MM-dd");
    if (days[d]) days[d].service += Number(i.grandTotal);
  }

  // Branch comparison
  const [openByBranch, deliveredByBranch] = await Promise.all([
    prisma.serviceJob.groupBy({ by: ["branchId"], where: { ...inB, status: OPEN }, _count: true }),
    prisma.serviceJob.findMany({ where: { ...inB, deliveredAt: { gte: from, lt: to } }, select: { branchId: true, receivedAt: true, deliveredAt: true } }),
  ]);
  const branchRows = branches.map((b) => {
    const delivered = deliveredByBranch.filter((d) => d.branchId === b.id);
    const tat = delivered.length ? delivered.reduce((a, d) => a + (d.deliveredAt!.getTime() - d.receivedAt.getTime()), 0) / delivered.length / 3600_000 : null;
    return {
      id: b.id,
      name: b.name,
      code: b.code,
      unit: b.businessUnit.name,
      isActive: b.isActive,
      salesRevenue: Number(sum(salesInvoices.filter((i) => i.branchId === b.id).map((i) => i.grandTotal))),
      serviceRevenue: Number(sum(serviceInvoices.filter((i) => i.branchId === b.id).map((i) => i.grandTotal))),
      openJobs: openByBranch.find((o) => o.branchId === b.id)?._count ?? 0,
      delivered: delivered.length,
      avgTurnaroundHours: tat === null ? null : Math.round(tat * 10) / 10,
    };
  });

  // Department managers only receive figures for their own area — enforced here, not just hidden in the page.
  const area = managerAreas(actor);
  if (!area.showroom) {
    for (const b of branchRows) b.salesRevenue = 0;
    for (const d of Object.values(days)) d.sales = 0;
  }
  if (!(area.workshop || area.money)) {
    for (const b of branchRows) b.serviceRevenue = 0;
    for (const d of Object.values(days)) d.service = 0;
  }
  const hide = <T,>(show: boolean, v: T) => (show ? v : null);
  return {
    range: { from: fromLabel, to: toLabel },
    kpis: {
      businessUnits: units,
      branches: branches.filter((b) => b.isActive).length,
      activeEmployees: employees,
      showroomStock: hide(area.showroom, showroomStock),
      jobsInProgress: hide(area.workshop, openJobs),
      awaitingApproval: hide(area.workshop, awaitingApproval),
      blockedByParts: hide(area.workshop, blockedJobs),
      overdueJobs: hide(area.workshop, overdueJobs),
      todaySales: hide(area.showroom, Number(D(todaySales._sum.grandTotal))),
      todayService: hide(area.workshop || area.money, Number(D(todayService._sum.grandTotal))),
      salesRevenue: hide(area.showroom, Number(sum(salesInvoices.map((i) => i.grandTotal)))),
      serviceRevenue: hide(area.workshop || area.money, Number(sum(serviceInvoices.map((i) => i.grandTotal)))),
      outstandingAmount: hide(area.money, Number(D(outstanding._sum.balanceDue))),
      outstandingCount: hide(area.money, outstanding._count),
      lowStock: hide(area.stores, balances.filter((b) => b.quantityOnHand - b.quantityReserved <= b.minStockLevel).length),
      clockedIn: hide(area.people, clockedIn),
      warrantyPending: claims,
    },
    series: Object.values(days),
    branches: branchRows,
    jobsByStatus: jobsByStatus.map((j) => ({ status: j.status, count: j._count })),
    approvals: { expenses: expensesPending, purchaseOrders: posPending, leaves: leavesPending, refunds: refundsPending, estimates: awaitingApproval },
    recent: !can(actor, "audit.view") ? [] : recentAudit.map((a) => ({ id: a.id, action: a.action, entityType: a.entityType, actor: a.actor?.name ?? "System", at: a.createdAt })),
    delayed: area.workshop ? delayed : [],
  };
}

// ─── Reports & CSV ───

export const REPORTS = {
  revenue: "Revenue by branch",
  service_jobs: "Service jobs",
  parts_delays: "Jobs delayed by spare parts",
  repeat_repairs: "Repeat repairs (30 days)",
  mechanic_productivity: "Mechanic productivity",
  parts_consumption: "Spare-part consumption",
  inventory_valuation: "Inventory valuation",
  stock_shortages: "Stock shortages",
  outstanding_invoices: "Outstanding invoices",
  followups: "Customer follow-up completion",
  warranty_claims: "Warranty claims",
  satisfaction: "Customer satisfaction",
  vehicle_sales: "Vehicle sales",
} as const;

export type ReportKey = keyof typeof REPORTS;

/** Area each report belongs to; department managers only get their own area's reports. */
const REPORT_AREA: Record<ReportKey, (keyof ReturnType<typeof managerAreas>)[]> = {
  revenue: ["money"],
  service_jobs: ["workshop"],
  parts_delays: ["workshop", "stores"],
  repeat_repairs: ["workshop"],
  mechanic_productivity: ["workshop"],
  parts_consumption: ["stores", "workshop"],
  inventory_valuation: ["stores"],
  stock_shortages: ["stores"],
  outstanding_invoices: ["money"],
  followups: ["workshop"],
  warranty_claims: ["workshop"],
  satisfaction: ["workshop"],
  vehicle_sales: ["showroom"],
};

/** Reports this person may run (OEM representatives: warranty only). */
export function allowedReports(actor: Actor): ReportKey[] {
  if (actor.roles.includes("OEM_REPRESENTATIVE") && !actor.allBranches) return ["warranty_claims"];
  const area = managerAreas(actor);
  return (Object.keys(REPORTS) as ReportKey[]).filter((k) => REPORT_AREA[k].some((a) => area[a]));
}
type Row = Record<string, string | number | null>;

export async function runReport(actor: Actor, key: ReportKey, q: RangeQuery): Promise<{ title: string; columns: string[]; rows: Row[] }> {
  if (key === "warranty_claims") requirePermission(actor, "reports.view", "warranty.view");
  else requirePermission(actor, "reports.view");
  if (!allowedReports(actor).includes(key)) throw forbidden("This report is outside your area.");
  const { from, to } = resolveRange(q);
  const branches = await branchIdsFor(actor, q);
  const ids = branches.map((b) => b.id);
  const bName = new Map(branches.map((b) => [b.id, b.name]));
  const inB = { branchId: { in: ids } };
  const range = { gte: from, lt: to };
  const fmt = (d: Date | null) => (d ? formatInTimeZone(d, GROUP_TZ, "yyyy-MM-dd HH:mm") : null);
  const title = REPORTS[key];
  void scope;

  switch (key) {
    case "revenue": {
      const inv = await prisma.invoice.groupBy({ by: ["branchId", "kind"], where: { ...inB, status: { in: ["FINALIZED", "PARTIALLY_PAID", "PAID"] }, finalizedAt: range }, _sum: { grandTotal: true, taxTotal: true, amountPaid: true }, _count: true });
      const rows = ids.map((id) => {
        const r = (k: string) => inv.find((i) => i.branchId === id && i.kind === k);
        return { branch: bName.get(id)!, vehicle_sales: Number(r("VEHICLE_SALE")?._sum.grandTotal ?? 0), service: Number(r("SERVICE")?._sum.grandTotal ?? 0), invoices: inv.filter((i) => i.branchId === id).reduce((a, i) => a + i._count, 0), tax: Number(sum(inv.filter((i) => i.branchId === id).map((i) => i._sum.taxTotal ?? 0))), collected: Number(sum(inv.filter((i) => i.branchId === id).map((i) => i._sum.amountPaid ?? 0))) };
      });
      return { title, columns: ["branch", "vehicle_sales", "service", "invoices", "tax", "collected"], rows };
    }
    case "service_jobs": {
      const jobs = await prisma.serviceJob.findMany({ where: { ...inB, receivedAt: range }, include: { customerVehicle: true, serviceAdvisor: { select: { name: true } } }, orderBy: { receivedAt: "asc" } });
      return {
        title,
        columns: ["job_number", "branch", "received", "status", "service_type", "vehicle", "registration", "advisor", "eta_latest", "delivered", "turnaround_hours"],
        rows: jobs.map((j) => ({ job_number: j.jobNumber, branch: bName.get(j.branchId)!, received: fmt(j.receivedAt), status: j.status, service_type: j.serviceType, vehicle: j.customerVehicle.modelName, registration: j.customerVehicle.registrationNumber, advisor: j.serviceAdvisor.name, eta_latest: fmt(j.etaLatest), delivered: fmt(j.deliveredAt), turnaround_hours: j.deliveredAt ? Math.round(((j.deliveredAt.getTime() - j.receivedAt.getTime()) / 3600_000) * 10) / 10 : null })),
      };
    }
    case "parts_delays": {
      const reqs = await prisma.sparePartRequest.findMany({ where: { ...inB, createdAt: range, OR: [{ status: { in: ["UNAVAILABLE", "AWAITING_PROCUREMENT"] } }, { availableAtRequest: { lt: 1 } }] }, include: { job: { select: { jobNumber: true, status: true } }, item: { select: { partNumber: true, name: true } }, issue: { select: { issuedAt: true } } } });
      return { title, columns: ["job_number", "branch", "part_number", "part", "qty", "status", "requested", "expected", "issued", "wait_hours"], rows: reqs.map((r) => ({ job_number: r.job.jobNumber, branch: bName.get(r.branchId)!, part_number: r.item.partNumber, part: r.item.name, qty: r.quantity, status: r.status, requested: fmt(r.createdAt), expected: fmt(r.expectedAvailableAt), issued: fmt(r.issue?.issuedAt ?? null), wait_hours: r.issue ? Math.round(((r.issue.issuedAt.getTime() - r.createdAt.getTime()) / 3600_000) * 10) / 10 : null })) };
    }
    case "repeat_repairs": {
      const jobs = await prisma.serviceJob.findMany({ where: { ...inB, receivedAt: range, status: { not: "CANCELLED" } }, select: { id: true, jobNumber: true, branchId: true, customerVehicleId: true, receivedAt: true, customerVehicle: { select: { registrationNumber: true } } } });
      const rows: Row[] = [];
      for (const j of jobs) {
        const prev = await prisma.serviceJob.findFirst({ where: { customerVehicleId: j.customerVehicleId, id: { not: j.id }, deliveredAt: { gte: new Date(j.receivedAt.getTime() - 30 * 86400_000), lt: j.receivedAt } }, select: { jobNumber: true, deliveredAt: true } });
        if (prev) rows.push({ job_number: j.jobNumber, branch: bName.get(j.branchId)!, registration: j.customerVehicle.registrationNumber, previous_job: prev.jobNumber, previous_delivered: fmt(prev.deliveredAt), days_between: Math.round((j.receivedAt.getTime() - prev.deliveredAt!.getTime()) / 86400_000) });
      }
      return { title, columns: ["job_number", "branch", "registration", "previous_job", "previous_delivered", "days_between"], rows };
    }
    case "mechanic_productivity": {
      const month = formatInTimeZone(from, GROUP_TZ, "yyyy-MM");
      const perf = await performance(actor, { branchId: q.branchId, period: month });
      return { title: `${title} (${month})`, columns: ["employee", "code", "branch", "tasks_completed", "jobs", "avg_task_minutes", "rework_tasks", "avg_rating"], rows: perf.filter((p) => p.roles.includes("MECHANIC")).map((p) => ({ employee: p.name, code: p.code, branch: p.branch, tasks_completed: p.service.tasksCompleted, jobs: p.service.jobsTouched, avg_task_minutes: p.service.avgTaskMinutes, rework_tasks: p.service.reworkTasks, avg_rating: p.service.avgRating })) };
    }
    case "parts_consumption": {
      const issues = await prisma.sparePartIssue.groupBy({ by: ["itemId"], where: { issuedAt: range, request: inB }, _sum: { quantity: true }, _count: true });
      const items = await prisma.inventoryItem.findMany({ where: { id: { in: issues.map((i) => i.itemId) } } });
      return { title, columns: ["part_number", "part", "category", "quantity", "issues"], rows: issues.map((i) => { const it = items.find((x) => x.id === i.itemId)!; return { part_number: it.partNumber, part: it.name, category: it.category, quantity: i._sum.quantity ?? 0, issues: i._count }; }).sort((a, b) => Number(b.quantity) - Number(a.quantity)) };
    }
    case "inventory_valuation": {
      if (!can(actor, "inventory.cost.view")) throw forbidden("Inventory cost data requires cost-view permission.");
      const bal = await prisma.inventoryBalance.findMany({ where: { ...inB, quantityOnHand: { gt: 0 } }, include: { item: true, location: { select: { code: true } } } });
      return { title, columns: ["branch", "location", "part_number", "part", "on_hand", "unit_cost", "value"], rows: bal.map((b) => ({ branch: bName.get(b.branchId)!, location: b.location.code, part_number: b.item.partNumber, part: b.item.name, on_hand: b.quantityOnHand, unit_cost: Number(b.item.purchaseCost), value: Number(D(b.item.purchaseCost).times(b.quantityOnHand).toFixed(2)) })) };
    }
    case "stock_shortages": {
      const bal = await prisma.inventoryBalance.findMany({ where: { ...inB, item: { isActive: true } }, include: { item: true } });
      return { title, columns: ["branch", "part_number", "part", "on_hand", "reserved", "available", "minimum"], rows: bal.filter((b) => b.quantityOnHand - b.quantityReserved <= b.minStockLevel).map((b) => ({ branch: bName.get(b.branchId)!, part_number: b.item.partNumber, part: b.item.name, on_hand: b.quantityOnHand, reserved: b.quantityReserved, available: b.quantityOnHand - b.quantityReserved, minimum: b.minStockLevel })) };
    }
    case "outstanding_invoices": {
      const inv = await prisma.invoice.findMany({ where: { ...inB, status: { in: ["FINALIZED", "PARTIALLY_PAID"] } }, include: { customer: { select: { fullName: true } } }, orderBy: { finalizedAt: "asc" } });
      return { title, columns: ["invoice", "branch", "customer", "finalized", "total", "paid", "balance", "age_days"], rows: inv.map((i) => ({ invoice: i.invoiceNumber, branch: bName.get(i.branchId)!, customer: i.customer.fullName, finalized: fmt(i.finalizedAt), total: Number(i.grandTotal), paid: Number(i.amountPaid), balance: Number(i.balanceDue), age_days: i.finalizedAt ? Math.floor((Date.now() - i.finalizedAt.getTime()) / 86400_000) : null })) };
    }
    case "followups": {
      const f = await prisma.followUp.groupBy({ by: ["branchId", "type", "status"], where: { ...inB, dueAt: range }, _count: true });
      return { title, columns: ["branch", "type", "status", "count"], rows: f.map((x) => ({ branch: bName.get(x.branchId)!, type: x.type, status: x.status, count: x._count })) };
    }
    case "warranty_claims": {
      const isOem = actor.roles.includes("OEM_REPRESENTATIVE") && !actor.allBranches;
      const c = await prisma.warrantyClaim.findMany({ where: { ...inB, createdAt: range, ...(isOem ? { businessUnitId: { in: actor.businessUnitIds }, status: { not: "DRAFT" } } : {}) }, orderBy: { createdAt: "asc" } });
      return { title, columns: ["claim", "branch", "manufacturer", "type", "status", "claimed", "reimbursed", "submitted", "resolved"], rows: c.map((x) => ({ claim: x.claimNumber, branch: bName.get(x.branchId)!, manufacturer: x.manufacturer, type: x.claimType, status: x.status, claimed: Number(x.claimAmount), reimbursed: x.reimbursedAmount ? Number(x.reimbursedAmount) : null, submitted: fmt(x.submittedAt), resolved: fmt(x.resolvedAt) })) };
    }
    case "satisfaction": {
      const fb = await prisma.customerFeedback.findMany({ where: { createdAt: range, serviceJob: inB }, select: { rating: true, serviceJob: { select: { branchId: true } } } });
      return { title, columns: ["branch", "responses", "average_rating", "low_ratings"], rows: ids.map((id) => { const r = fb.filter((f) => f.serviceJob.branchId === id).map((f) => f.rating); return { branch: bName.get(id)!, responses: r.length, average_rating: r.length ? Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 10) / 10 : null, low_ratings: r.filter((x) => x <= 2).length }; }) };
    }
    case "vehicle_sales": {
      const b = await prisma.vehicleBooking.findMany({ where: { ...inB, deliveredAt: range, status: "DELIVERED" }, include: { vehicleModel: true, vehicle: { select: { vin: true, colour: true } }, customer: { select: { fullName: true } } } });
      return { title, columns: ["booking", "branch", "model", "colour", "chassis", "customer", "delivered", "discount", "total"], rows: b.map((x) => ({ booking: x.bookingNumber, branch: bName.get(x.branchId)!, model: `${x.vehicleModel.name} ${x.vehicleModel.variant}`.trim(), colour: x.vehicle?.colour ?? null, chassis: x.vehicle?.vin ?? null, customer: x.customer.fullName, delivered: fmt(x.deliveredAt), discount: Number(x.discountAmount), total: Number(x.totalAmount) })) };
    }
  }
}

/** RFC 4180 CSV with formula-injection protection for spreadsheet apps. */
export function toCsv(columns: string[], rows: Row[]) {
  const esc = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c] ?? null)).join(","))].join("\r\n");
}
