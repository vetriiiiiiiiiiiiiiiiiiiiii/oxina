import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { branchFilter, can, type Actor } from "@/lib/rbac/actor";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

/**
 * "What needs doing" lists for the home page. Each queue is only computed when the actor
 * holds the permission for that kind of work, and is always scoped to their branches.
 */

const OPEN: Prisma.EnumServiceJobStatusFilter = { notIn: ["DELIVERED", "CLOSED", "CANCELLED"] };
const jobSelect = {
  id: true,
  jobNumber: true,
  status: true,
  receivedAt: true,
  etaLatest: true,
  etaConfidence: true,
  expectedCompletionAt: true,
  readyAt: true,
  updatedAt: true,
  branch: { select: { name: true, code: true, timezone: true } },
  customer: { select: { fullName: true, phone: true } },
  customerVehicle: { select: { registrationNumber: true, modelName: true } },
  serviceAdvisor: { select: { name: true } },
} satisfies Prisma.ServiceJobSelect;

export type QueueJob = Prisma.ServiceJobGetPayload<{ select: typeof jobSelect }>;

function todayRange() {
  const day = formatInTimeZone(new Date(), "Asia/Kolkata", "yyyy-MM-dd");
  const from = fromZonedTime(`${day}T00:00:00`, "Asia/Kolkata");
  return { from, to: new Date(from.getTime() + 86400_000) };
}

/** Jobs that need a person to act, each with the reason. Used by managers and advisors. */
export async function attentionList(actor: Actor, branchId?: string, onlyMine = false) {
  const scope = { ...branchFilter(actor, branchId), ...(onlyMine ? { serviceAdvisorId: actor.userId } : {}) };
  const now = new Date();
  const hours = (h: number) => new Date(now.getTime() - h * 3600_000);
  const [late, noPartDate, waitingCustomer, readyNotCollected, notStarted] = await Promise.all([
    prisma.serviceJob.findMany({ where: { ...scope, status: { notIn: ["DELIVERED", "CLOSED", "CANCELLED", "READY_FOR_DELIVERY"] }, OR: [{ etaLatest: { lt: now } }, { etaLatest: null, expectedCompletionAt: { lt: now } }] }, select: jobSelect, take: 20 }),
    prisma.serviceJob.findMany({ where: { ...scope, status: OPEN, partRequests: { some: { status: { in: ["UNAVAILABLE", "AWAITING_PROCUREMENT"] }, OR: [{ expectedAvailableAt: null }, { expectedAvailableAt: { lt: now } }] } } }, select: jobSelect, take: 20 }),
    prisma.serviceJob.findMany({ where: { ...scope, status: "AWAITING_APPROVAL", estimates: { some: { status: "SENT", sentAt: { lt: hours(3) } } } }, select: jobSelect, take: 20 }),
    prisma.serviceJob.findMany({ where: { ...scope, status: "READY_FOR_DELIVERY", readyAt: { lt: hours(24) } }, select: jobSelect, take: 20 }),
    prisma.serviceJob.findMany({ where: { ...scope, status: "RECEIVED", receivedAt: { lt: hours(1) } }, select: jobSelect, take: 20 }),
  ]);
  const items: { job: QueueJob; reason: string; tone: "bad" | "warn" | "neutral" }[] = [];
  const seen = new Set<string>();
  const add = (jobs: QueueJob[], reason: (j: QueueJob) => string, tone: "bad" | "warn" | "neutral") => {
    for (const j of jobs) {
      if (seen.has(j.id)) continue;
      seen.add(j.id);
      items.push({ job: j, reason: reason(j), tone });
    }
  };
  add(noPartDate, () => "Part missing with no valid arrival date (none recorded, or it has passed) — get a new date so the customer has a completion time", "bad");
  add(late, () => "Past the promised completion time", "bad");
  add(waitingCustomer, () => "Estimate sent over 3 hours ago, no reply — call the customer", "warn");
  add(readyNotCollected, () => "Ready for over a day, not collected", "warn");
  add(notStarted, () => "Received over an hour ago, inspection not started", "neutral");
  return items;
}

/** Workshop pipeline: open jobs per stage. */
export async function pipeline(actor: Actor, branchId?: string) {
  const rows = await prisma.serviceJob.groupBy({ by: ["status"], where: { ...branchFilter(actor, branchId), status: OPEN }, _count: true });
  return Object.fromEntries(rows.map((r) => [r.status, r._count])) as Record<string, number>;
}

export async function todayCounts(actor: Actor, branchId?: string) {
  const { from, to } = todayRange();
  const scope = branchFilter(actor, branchId);
  const [received, delivered, readyNow] = await Promise.all([
    prisma.serviceJob.count({ where: { ...scope, receivedAt: { gte: from, lt: to } } }),
    prisma.serviceJob.count({ where: { ...scope, deliveredAt: { gte: from, lt: to } } }),
    prisma.serviceJob.count({ where: { ...scope, status: "READY_FOR_DELIVERY" } }),
  ]);
  return { received, delivered, readyNow };
}

/** Current load per mechanic: what they are on now and what is queued for them. */
export async function mechanicLoad(actor: Actor, branchId?: string) {
  const branches = branchFilter(actor, branchId).branchId;
  const mechanics = await prisma.user.findMany({
    where: { isActive: true, roles: { some: { role: { key: "MECHANIC" } } }, ...(branches ? { branchAssignments: { some: { branchId: branches } } } : {}) },
    select: {
      id: true,
      name: true,
      assignedTasks: {
        where: { status: { in: ["READY", "IN_PROGRESS", "PAUSED", "BLOCKED"] }, job: { status: OPEN } },
        select: { id: true, title: true, status: true, estimatedMaxMinutes: true, workedMinutes: true, job: { select: { id: true, jobNumber: true, customerVehicle: { select: { registrationNumber: true } } } } },
      },
    },
    orderBy: { name: "asc" },
  });
  return mechanics.map((m) => ({
    id: m.id,
    name: m.name,
    current: m.assignedTasks.find((t) => t.status === "IN_PROGRESS") ?? null,
    queued: m.assignedTasks.filter((t) => t.status !== "IN_PROGRESS").length,
    blocked: m.assignedTasks.filter((t) => t.status === "BLOCKED").length,
    queuedMinutes: m.assignedTasks.reduce((a, t) => a + Math.max(0, t.estimatedMaxMinutes - t.workedMinutes), 0),
  }));
}

export async function partShortages(actor: Actor, branchId?: string) {
  return prisma.sparePartRequest.findMany({
    where: { ...branchFilter(actor, branchId), status: { in: ["UNAVAILABLE", "AWAITING_PROCUREMENT"] } },
    orderBy: [{ expectedAvailableAt: { sort: "asc", nulls: "first" } }],
    take: 15,
    select: { id: true, quantity: true, status: true, expectedAvailableAt: true, item: { select: { name: true, partNumber: true } }, job: { select: { id: true, jobNumber: true } } },
  });
}

/** Queues for front-line roles. Each is null when the actor doesn't do that kind of work. */
export async function myQueues(actor: Actor, branchId?: string) {
  const scope = branchFilter(actor, branchId);
  const { from, to } = todayRange();
  const advisor = can(actor, "service.job.create") && !can(actor, "dashboard.branch");
  const [myJobs, qcDue, billingDue, paymentsToConfirm, pickQueue, leadsDue, testRidesToday, followUpsDue, myBookings] = await Promise.all([
    advisor ? prisma.serviceJob.findMany({ where: { ...scope, serviceAdvisorId: actor.userId, status: OPEN }, select: jobSelect, orderBy: { receivedAt: "asc" } }) : null,
    can(actor, "service.quality.inspect") && !can(actor, "dashboard.branch") ? prisma.serviceJob.findMany({ where: { ...scope, status: "QUALITY_CHECK" }, select: jobSelect, orderBy: { updatedAt: "asc" } }) : null,
    can(actor, "billing.manage") && !can(actor, "dashboard.branch") ? prisma.serviceJob.findMany({ where: { ...scope, status: "FINAL_BILLING" }, select: { ...jobSelect, invoices: { where: { status: { not: "CANCELLED" } }, select: { id: true, status: true, balanceDue: true } } }, orderBy: { updatedAt: "asc" } }) : null,
    can(actor, "payments.confirm") && !can(actor, "dashboard.branch") ? prisma.payment.findMany({ where: { ...scope, status: "PENDING_CONFIRMATION" }, select: { id: true, amount: true, method: true, reference: true, createdAt: true, customer: { select: { fullName: true } }, invoice: { select: { id: true, invoiceNumber: true } } } }) : null,
    can(actor, "inventory.issue") && !can(actor, "dashboard.branch") ? prisma.sparePartRequest.findMany({ where: { ...scope, status: { in: ["RESERVED", "PICKING", "PICKED"] } }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }], select: { id: true, status: true, quantity: true, priority: true, createdAt: true, item: { select: { name: true, partNumber: true } }, location: { select: { code: true } }, job: { select: { id: true, jobNumber: true } }, assignedMechanic: { select: { name: true } } } }) : null,
    can(actor, "showroom.leads.manage") && !can(actor, "dashboard.branch") ? prisma.salesLead.findMany({ where: { ...scope, assignedToId: actor.userId, status: { notIn: ["BOOKED", "LOST"] }, OR: [{ nextFollowUpAt: { lt: new Date(to.getTime() + 3 * 86400_000) } }, { nextFollowUpAt: null }] }, orderBy: { nextFollowUpAt: { sort: "asc", nulls: "first" } }, select: { id: true, name: true, phone: true, status: true, nextFollowUpAt: true, interestedModel: { select: { name: true } } } }) : null,
    can(actor, "showroom.leads.manage") && !can(actor, "dashboard.branch") ? prisma.showroomTestRide.findMany({ where: { ...scope, status: "SCHEDULED", scheduledAt: { gte: from, lt: to } }, orderBy: { scheduledAt: "asc" }, select: { id: true, scheduledAt: true, lead: { select: { id: true, name: true } }, vehicleModel: { select: { name: true } } } }) : null,
    can(actor, "followups.manage") ? prisma.followUp.count({ where: { ...scope, status: "PENDING", dueAt: { lt: to }, ...(advisor ? { assignedToId: actor.userId } : {}) } }) : null,
    can(actor, "showroom.bookings.manage") && !can(actor, "dashboard.branch") ? prisma.vehicleBooking.findMany({ where: { ...scope, salesExecutiveId: actor.userId, status: { notIn: ["DELIVERED", "CANCELLED"] } }, orderBy: { createdAt: "asc" }, select: { id: true, bookingNumber: true, status: true, totalAmount: true, deliveryScheduledAt: true, customer: { select: { fullName: true } }, vehicleModel: { select: { name: true } } } }) : null,
  ]);
  return { myJobs, qcDue, billingDue, paymentsToConfirm, pickQueue, leadsDue, testRidesToday, followUpsDue, myBookings };
}

/** Showroom manager's view: pipeline, bookings needing action, overdue follow-ups. */
export async function showroomSummary(actor: Actor, branchId?: string) {
  const scope = branchFilter(actor, branchId);
  const now = new Date();
  const [leads, bookings, overdueLeads, unconfirmed, ready, stock] = await Promise.all([
    prisma.salesLead.groupBy({ by: ["status"], where: { ...scope, status: { notIn: ["BOOKED", "LOST"] } }, _count: true }),
    prisma.vehicleBooking.groupBy({ by: ["status"], where: { ...scope, status: { notIn: ["DELIVERED", "CANCELLED"] } }, _count: true }),
    prisma.salesLead.findMany({ where: { ...scope, status: { notIn: ["BOOKED", "LOST"] }, nextFollowUpAt: { lt: now } }, orderBy: { nextFollowUpAt: "asc" }, take: 10, select: { id: true, name: true, phone: true, nextFollowUpAt: true, assignedTo: { select: { name: true } } } }),
    prisma.payment.count({ where: { ...scope, bookingId: { not: null }, status: "PENDING_CONFIRMATION" } }),
    prisma.vehicleBooking.findMany({ where: { ...scope, status: "READY_FOR_DELIVERY" }, take: 10, select: { id: true, bookingNumber: true, deliveryScheduledAt: true, customer: { select: { fullName: true } }, vehicleModel: { select: { name: true } } } }),
    prisma.vehicle.groupBy({ by: ["status"], where: { ...scope, status: { notIn: ["DELIVERED", "TRANSFERRED", "RETURNED"] } }, _count: true }),
  ]);
  const count = (rows: { status: string; _count: number }[]) => Object.fromEntries(rows.map((r) => [r.status, r._count])) as Record<string, number>;
  return { leads: count(leads), bookings: count(bookings), overdueLeads, unconfirmedPayments: unconfirmed, ready, stock: count(stock) };
}

/** Stores manager's view: workshop queue, POs to approve/receive, transfers. */
export async function storesSummary(actor: Actor, branchId?: string) {
  const scope = branchFilter(actor, branchId);
  const bf = scope.branchId;
  const [toPick, poToApprove, poToReceive, transfers] = await Promise.all([
    prisma.sparePartRequest.count({ where: { ...scope, status: { in: ["RESERVED", "PICKING", "PICKED"] } } }),
    prisma.purchaseOrder.findMany({ where: { ...scope, status: "SUBMITTED" }, take: 10, select: { id: true, poNumber: true, totalAmount: true, supplier: { select: { name: true } } } }),
    prisma.purchaseOrder.findMany({ where: { ...scope, status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] } }, take: 10, select: { id: true, poNumber: true, expectedDate: true, status: true, supplier: { select: { name: true } } } }),
    prisma.stockTransfer.count({ where: { OR: [{ status: { in: ["REQUESTED", "APPROVED"] }, ...(bf ? { fromBranchId: bf } : {}) }, { status: "DISPATCHED", ...(bf ? { toBranchId: bf } : {}) }] } }),
  ]);
  return { toPick, poToApprove, poToReceive, transfers };
}
