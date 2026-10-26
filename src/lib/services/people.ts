import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { forbidden, invalid, notFound, rule } from "@/lib/errors";
import { assertBranch, branchFilter, can, requirePermission, type Actor } from "@/lib/rbac/actor";
import { audit } from "@/lib/audit";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { getBranchSetting } from "./settings";

// ─── Employees ───

export const employeeInput = z.object({
  branchId: z.string().uuid(),
  employeeCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,20}$/),
  fullName: z.string().trim().min(2).max(120),
  workEmail: z.string().trim().toLowerCase().email().optional().or(z.literal("").transform(() => undefined)),
  workPhone: z.string().trim().max(20).optional(),
  designation: z.string().trim().min(2).max(80),
  departmentId: z.string().uuid().optional(),
  joiningDate: z.coerce.date(),
  reportingManagerId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
});

export async function createEmployee(actor: Actor, input: z.infer<typeof employeeInput>) {
  requirePermission(actor, "employees.manage");
  assertBranch(actor, input.branchId, "Branch");
  return prisma.$transaction(async (tx) => {
    if (input.departmentId && !(await tx.department.findFirst({ where: { id: input.departmentId, branchId: input.branchId } }))) throw invalid("Department is not in this branch.");
    if (input.userId && !(await tx.userBranchAssignment.findFirst({ where: { userId: input.userId, branchId: input.branchId } }))) throw invalid("Linked user is not assigned to this branch.");
    const e = await tx.employee.create({ data: input });
    await audit(tx, { actorId: actor.userId, action: "employee.create", entityType: "Employee", entityId: e.id, branchId: input.branchId });
    return e;
  });
}

export const employeeUpdateInput = employeeInput.partial().extend({ status: z.enum(["ACTIVE", "ON_LEAVE", "RESIGNED", "TERMINATED"]).optional() });

export async function updateEmployee(actor: Actor, id: string, input: z.infer<typeof employeeUpdateInput>) {
  requirePermission(actor, "employees.manage");
  const e = await prisma.employee.findUnique({ where: { id } });
  if (!e) throw notFound("Employee");
  assertBranch(actor, e.branchId, "Employee");
  if (input.branchId) assertBranch(actor, input.branchId, "Branch");
  return prisma.$transaction(async (tx) => {
    const after = await tx.employee.update({ where: { id }, data: input });
    await audit(tx, { actorId: actor.userId, action: "employee.update", entityType: "Employee", entityId: id, branchId: e.branchId, before: e, after });
    return after;
  });
}

export async function listEmployees(actor: Actor, q: { branchId?: string; search?: string }) {
  requirePermission(actor, "employees.view");
  return prisma.employee.findMany({
    where: {
      ...branchFilter(actor, q.branchId),
      ...(q.search ? { OR: [{ fullName: { contains: q.search, mode: "insensitive" } }, { employeeCode: { contains: q.search, mode: "insensitive" } }] } : {}),
    },
    orderBy: { fullName: "asc" },
    include: { branch: { select: { name: true } }, department: { select: { name: true } }, reportingManager: { select: { fullName: true } }, user: { select: { id: true, roles: { select: { role: { select: { name: true } } } } } } },
  });
}

// ─── Attendance (prototype: self-reported, unverified) ───

async function myEmployee(actor: Actor) {
  const e = await prisma.employee.findUnique({ where: { userId: actor.userId }, include: { branch: true } });
  if (!e) throw rule("Your account is not linked to an employee profile. Ask your manager.");
  if (e.status !== "ACTIVE") throw rule("Attendance is only recorded for active employees.");
  return e;
}

function todayIn(tz: string) {
  return formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
}

export async function attendanceToday(actor: Actor) {
  requirePermission(actor, "attendance.self");
  const e = await prisma.employee.findUnique({ where: { userId: actor.userId }, include: { branch: true } });
  if (!e) return null;
  const rec = await prisma.attendanceRecord.findUnique({ where: { employeeId_workDate: { employeeId: e.id, workDate: new Date(todayIn(e.branch.timezone)) } } });
  return { employee: { id: e.id, fullName: e.fullName, employeeCode: e.employeeCode, branch: e.branch.name, timezone: e.branch.timezone }, record: rec };
}

export async function clockAction(actor: Actor, action: "IN" | "OUT" | "BREAK_START" | "BREAK_END") {
  requirePermission(actor, "attendance.self");
  const e = await myEmployee(actor);
  const tz = e.branch.timezone;
  const day = todayIn(tz);
  const now = new Date();
  const workDate = new Date(day);
  return prisma.$transaction(async (tx) => {
    const rec = await tx.attendanceRecord.findUnique({ where: { employeeId_workDate: { employeeId: e.id, workDate } } });
    if (action === "IN") {
      if (rec?.clockInAt) throw rule("You have already clocked in today.");
      const grace = Number(await getBranchSetting(tx, e.branchId, "attendance.graceMinutes"));
      const start = fromZonedTime(`${day}T${e.branch.workdayStart}:00`, tz);
      return tx.attendanceRecord.upsert({
        where: { employeeId_workDate: { employeeId: e.id, workDate } },
        create: { employeeId: e.id, branchId: e.branchId, workDate, clockInAt: now, isLate: now.getTime() > start.getTime() + grace * 60_000 },
        update: { clockInAt: now, status: "PRESENT" },
      });
    }
    if (!rec?.clockInAt) throw rule("Clock in first.");
    if (rec.clockOutAt) throw rule("You have already clocked out today.");
    if (action === "BREAK_START") {
      if (rec.onBreakSince) throw rule("You are already on a break.");
      return tx.attendanceRecord.update({ where: { id: rec.id }, data: { onBreakSince: now } });
    }
    if (action === "BREAK_END") {
      if (!rec.onBreakSince) throw rule("You are not on a break.");
      const mins = Math.round((now.getTime() - rec.onBreakSince.getTime()) / 60_000);
      return tx.attendanceRecord.update({ where: { id: rec.id }, data: { onBreakSince: null, breakMinutes: rec.breakMinutes + mins } });
    }
    const openBreak = rec.onBreakSince ? Math.round((now.getTime() - rec.onBreakSince.getTime()) / 60_000) : 0;
    const breakMinutes = rec.breakMinutes + openBreak;
    const end = fromZonedTime(`${day}T${e.branch.workdayEnd}:00`, tz);
    return tx.attendanceRecord.update({
      where: { id: rec.id },
      data: { clockOutAt: now, onBreakSince: null, breakMinutes, workedMinutes: Math.max(0, Math.round((now.getTime() - rec.clockInAt.getTime()) / 60_000) - breakMinutes), isEarlyDeparture: now < end },
    });
  });
}

export const correctionInput = z.object({ attendanceId: z.string().uuid(), requestedClockIn: z.coerce.date().optional(), requestedClockOut: z.coerce.date().optional(), reason: z.string().trim().min(5).max(500) });

export async function requestCorrection(actor: Actor, input: z.infer<typeof correctionInput>) {
  requirePermission(actor, "attendance.self");
  const e = await myEmployee(actor);
  const rec = await prisma.attendanceRecord.findFirst({ where: { id: input.attendanceId, employeeId: e.id } });
  if (!rec) throw notFound("Attendance record");
  return prisma.attendanceCorrection.create({ data: { attendanceId: rec.id, requestedById: actor.userId, requestedClockIn: input.requestedClockIn, requestedClockOut: input.requestedClockOut, reason: input.reason } });
}

export async function reviewCorrection(actor: Actor, id: string, approve: boolean) {
  requirePermission(actor, "attendance.manage");
  const c = await prisma.attendanceCorrection.findUnique({ where: { id }, include: { attendance: true } });
  if (!c) throw notFound("Correction");
  assertBranch(actor, c.attendance.branchId, "Correction");
  if (c.status !== "PENDING") throw rule("Already reviewed.");
  if (c.requestedById === actor.userId) throw forbidden("You cannot approve your own correction.");
  await prisma.$transaction(async (tx) => {
    await tx.attendanceCorrection.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", reviewedById: actor.userId, reviewedAt: new Date() } });
    if (approve) {
      const inAt = c.requestedClockIn ?? c.attendance.clockInAt;
      const outAt = c.requestedClockOut ?? c.attendance.clockOutAt;
      await tx.attendanceRecord.update({
        where: { id: c.attendanceId },
        data: { clockInAt: inAt, clockOutAt: outAt, workedMinutes: inAt && outAt ? Math.max(0, Math.round((outAt.getTime() - inAt.getTime()) / 60_000) - c.attendance.breakMinutes) : null, notes: `Corrected: ${c.reason}` },
      });
    }
    await audit(tx, { actorId: actor.userId, action: approve ? "attendance.correction.approve" : "attendance.correction.reject", entityType: "AttendanceCorrection", entityId: id, branchId: c.attendance.branchId });
  });
}

export const leaveInput = z.object({ leaveType: z.enum(["CASUAL", "SICK", "EARNED", "UNPAID"]), startDate: z.coerce.date(), endDate: z.coerce.date(), reason: z.string().trim().min(3).max(500) });

export async function applyLeave(actor: Actor, input: z.infer<typeof leaveInput>) {
  requirePermission(actor, "attendance.self");
  const e = await myEmployee(actor);
  if (input.endDate < input.startDate) throw invalid("End date must be on or after the start date.");
  return prisma.leaveRequest.create({ data: { ...input, employeeId: e.id, branchId: e.branchId } });
}

export async function reviewLeave(actor: Actor, id: string, approve: boolean) {
  requirePermission(actor, "attendance.manage");
  const l = await prisma.leaveRequest.findUnique({ where: { id }, include: { employee: true } });
  if (!l) throw notFound("Leave request");
  assertBranch(actor, l.branchId, "Leave request");
  if (l.status !== "PENDING") throw rule("Already reviewed.");
  if (l.employee.userId === actor.userId) throw forbidden("You cannot approve your own leave.");
  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", reviewedById: actor.userId, reviewedAt: new Date() } });
    await audit(tx, { actorId: actor.userId, action: approve ? "leave.approve" : "leave.reject", entityType: "LeaveRequest", entityId: id, branchId: l.branchId });
  });
}

export async function attendanceOverview(actor: Actor, q: { branchId?: string; month: string }) {
  const manage = can(actor, "attendance.manage");
  if (!manage) requirePermission(actor, "attendance.self");
  const [y, m] = q.month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  const own = manage ? {} : { employee: { userId: actor.userId } };
  const where: Prisma.AttendanceRecordWhereInput = { ...(manage ? branchFilter(actor, q.branchId) : {}), ...own, workDate: { gte: from, lt: to } };
  const [records, corrections, leaves] = await Promise.all([
    prisma.attendanceRecord.findMany({ where, orderBy: [{ workDate: "desc" }], include: { employee: { select: { fullName: true, employeeCode: true } } }, take: 1000 }),
    prisma.attendanceCorrection.findMany({ where: { status: "PENDING", attendance: { ...(manage ? branchFilter(actor, q.branchId) : {}), ...own } }, include: { attendance: { include: { employee: { select: { fullName: true } } } } } }),
    prisma.leaveRequest.findMany({ where: { ...(manage ? branchFilter(actor, q.branchId) : { employee: { userId: actor.userId } }), OR: [{ status: "PENDING" }, { startDate: { gte: from, lt: to } }] }, include: { employee: { select: { fullName: true, userId: true } } }, orderBy: { startDate: "desc" } }),
  ]);
  const byEmployee = new Map<string, { name: string; code: string; days: number; late: number; early: number; minutes: number }>();
  for (const r of records) {
    const s = byEmployee.get(r.employeeId) ?? { name: r.employee.fullName, code: r.employee.employeeCode, days: 0, late: 0, early: 0, minutes: 0 };
    s.days += r.clockInAt ? 1 : 0;
    s.late += r.isLate ? 1 : 0;
    s.early += r.isEarlyDeparture ? 1 : 0;
    s.minutes += r.workedMinutes ?? 0;
    byEmployee.set(r.employeeId, s);
  }
  return { records, corrections, leaves, summary: [...byEmployee.values()], manage };
}

// ─── Targets & performance ───

export const targetInput = z.object({
  employeeId: z.string().uuid(),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  metric: z.enum(["VEHICLES_SOLD", "SALES_REVENUE", "LEADS_CONVERTED", "JOBS_COMPLETED", "REQUESTS_FULFILLED"]),
  targetValue: z.coerce.number().min(0),
});

export async function setTarget(actor: Actor, input: z.infer<typeof targetInput>) {
  requirePermission(actor, "targets.manage");
  const e = await prisma.employee.findUnique({ where: { id: input.employeeId } });
  if (!e) throw notFound("Employee");
  assertBranch(actor, e.branchId, "Employee");
  return prisma.employeeTarget.upsert({
    where: { employeeId_period_metric: { employeeId: e.id, period: input.period, metric: input.metric } },
    create: { ...input, branchId: e.branchId },
    update: { targetValue: input.targetValue },
  });
}

/** Performance computed from operational records for a month. Employees see only themselves. */
export async function performance(actor: Actor, q: { branchId?: string; period: string }) {
  requirePermission(actor, "targets.view");
  const [y, m] = q.period.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  const seeAll = can(actor, "targets.manage") || can(actor, "employees.view");
  const employees = await prisma.employee.findMany({
    where: { ...(seeAll ? branchFilter(actor, q.branchId) : { userId: actor.userId }), userId: { not: null } },
    include: { user: { select: { id: true, roles: { select: { role: { select: { key: true } } } } } }, targets: { where: { period: q.period } }, branch: { select: { name: true } } },
  });
  const ids = employees.map((e) => e.userId!);
  const [sold, leadsAll, leadsWon, tasksDone, reworked, issues, requests, qc, feedback] = await Promise.all([
    prisma.vehicleBooking.groupBy({ by: ["salesExecutiveId"], where: { salesExecutiveId: { in: ids }, status: "DELIVERED", deliveredAt: { gte: from, lt: to } }, _count: true, _sum: { totalAmount: true } }),
    prisma.salesLead.groupBy({ by: ["assignedToId"], where: { assignedToId: { in: ids }, createdAt: { gte: from, lt: to } }, _count: true }),
    prisma.salesLead.groupBy({ by: ["assignedToId"], where: { assignedToId: { in: ids }, status: "BOOKED", updatedAt: { gte: from, lt: to } }, _count: true }),
    prisma.repairTask.findMany({ where: { assignedMechanicId: { in: ids }, status: "COMPLETED", completedAt: { gte: from, lt: to } }, select: { assignedMechanicId: true, workedMinutes: true, jobId: true } }),
    prisma.repairTask.groupBy({ by: ["assignedMechanicId"], where: { assignedMechanicId: { in: ids }, reworkCount: { gt: 0 }, updatedAt: { gte: from, lt: to } }, _count: true }),
    prisma.sparePartIssue.findMany({ where: { issuedById: { in: ids }, issuedAt: { gte: from, lt: to } }, select: { issuedById: true, issuedAt: true, request: { select: { createdAt: true } } } }),
    prisma.sparePartRequest.count({ where: { status: { in: ["RESERVED", "PICKING", "PICKED"] }, ...(seeAll ? branchFilter(actor, q.branchId) : { branchId: { in: employees.map((e) => e.branchId) } }) } }),
    prisma.qualityInspection.groupBy({ by: ["inspectorId", "result"], where: { inspectorId: { in: ids }, completedAt: { gte: from, lt: to } }, _count: true }),
    prisma.customerFeedback.findMany({ where: { createdAt: { gte: from, lt: to }, serviceJob: { tasks: { some: { assignedMechanicId: { in: ids } } } } }, select: { rating: true, serviceJob: { select: { tasks: { select: { assignedMechanicId: true } } } } } }),
  ]);
  return employees.map((e) => {
    const uid = e.userId!;
    const myTasks = tasksDone.filter((t) => t.assignedMechanicId === uid);
    const myIssues = issues.filter((i) => i.issuedById === uid);
    const ratings = feedback.filter((f) => f.serviceJob.tasks.some((t) => t.assignedMechanicId === uid)).map((f) => f.rating);
    const qcPass = qc.find((x) => x.inspectorId === uid && x.result === "PASSED")?._count ?? 0;
    const qcFail = qc.find((x) => x.inspectorId === uid && x.result === "FAILED")?._count ?? 0;
    return {
      employeeId: e.id,
      name: e.fullName,
      code: e.employeeCode,
      branch: e.branch.name,
      roles: e.user?.roles.map((r) => r.role.key) ?? [],
      targets: e.targets.map((t) => ({ metric: t.metric, target: Number(t.targetValue) })),
      sales: {
        vehiclesSold: sold.find((s) => s.salesExecutiveId === uid)?._count ?? 0,
        revenue: Number(sold.find((s) => s.salesExecutiveId === uid)?._sum.totalAmount ?? 0),
        leads: leadsAll.find((s) => s.assignedToId === uid)?._count ?? 0,
        leadsConverted: leadsWon.find((s) => s.assignedToId === uid)?._count ?? 0,
      },
      service: {
        tasksCompleted: myTasks.length,
        jobsTouched: new Set(myTasks.map((t) => t.jobId)).size,
        avgTaskMinutes: myTasks.length ? Math.round(myTasks.reduce((a, t) => a + t.workedMinutes, 0) / myTasks.length) : null,
        reworkTasks: reworked.find((r) => r.assignedMechanicId === uid)?._count ?? 0,
        avgRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
        qcPassed: qcPass,
        qcFailed: qcFail,
      },
      warehouse: {
        requestsFulfilled: myIssues.length,
        avgFulfilmentMinutes: myIssues.length ? Math.round(myIssues.reduce((a, i) => a + (i.issuedAt.getTime() - i.request.createdAt.getTime()) / 60_000, 0) / myIssues.length) : null,
        pendingRequests: requests,
      },
    };
  });
}
