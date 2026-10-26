import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { conflict, invalid, notFound, rule } from "@/lib/errors";
import { assertBranch, branchFilter, can, requirePermission, type Actor } from "@/lib/rbac/actor";
import { audit } from "@/lib/audit";
import { nextNumber } from "@/lib/numbering";
import { notifyUsers, queueCustomerMessage } from "@/lib/notifications";
import { createCustomerTx, customerInput, getCustomerForActor, phoneSchema } from "../customers";
import { activity, afterCommit, assertJobOpen, getJobForActor, lockJob, setJobStatus, templateValues, timeline } from "./common";

const regNo = z
  .string()
  .trim()
  .toUpperCase()
  .transform((s) => s.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^[A-Z0-9]{6,12}$/, "Enter a valid registration number."));

export const createJobInput = z.object({
  branchId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  confirmPhone: phoneSchema.optional(),
  newCustomer: customerInput.optional(),
  vehicle: z.object({
    registrationNumber: regNo,
    vehicleModelId: z.string().uuid().optional(),
    modelName: z.string().trim().min(2).max(120),
    vin: z.string().trim().toUpperCase().max(25).optional().or(z.literal("").transform(() => undefined)),
  }),
  serviceType: z.enum(["PERIODIC_SERVICE", "FREE_SERVICE", "GENERAL_REPAIR", "ACCIDENT_REPAIR", "WARRANTY_REPAIR", "BREAKDOWN", "INSPECTION_ONLY"]),
  isEmergency: z.boolean().default(false),
  odometerIn: z.coerce.number().int().min(0).max(2_000_000),
  fuelLevel: z.enum(["EMPTY", "QUARTER", "HALF", "THREE_QUARTER", "FULL"]),
  reportedProblems: z.string().trim().min(3).max(2000),
  vehicleCondition: z.string().trim().max(2000).optional(),
  existingDamage: z.string().trim().max(2000).optional(),
  accessoriesReceived: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  expectedCompletionAt: z.coerce.date().optional(),
  serviceAdvisorId: z.string().uuid().optional(),
});

export async function createServiceJob(actor: Actor, input: z.infer<typeof createJobInput>) {
  requirePermission(actor, "service.job.create");
  assertBranch(actor, input.branchId, "Branch");
  if (!input.customerId && !input.newCustomer) throw invalid("Select an existing customer or enter new customer details.");
  if (input.customerId) {
    // Customers are group-wide. One outside this staff member's scope (e.g. first visit to this
    // branch) may only be selected by presenting their exact phone number, as at the counter.
    const inScope = await getCustomerForActor(actor, input.customerId).then(() => true, () => false);
    if (!inScope) {
      const c = await prisma.customer.findUnique({ where: { id: input.customerId }, select: { phone: true } });
      if (!c || !input.confirmPhone || c.phone !== input.confirmPhone) throw notFound("Customer");
    }
  }

  const advisorId = input.serviceAdvisorId ?? actor.userId;
  const result = await prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: input.branchId }, include: { businessUnit: true } });
    if (!branch.isActive) throw rule("This branch is inactive.");
    if (advisorId !== actor.userId) {
      const ok = await tx.userBranchAssignment.findFirst({ where: { userId: advisorId, branchId: branch.id, user: { isActive: true } } });
      if (!ok) throw invalid("The selected service advisor is not assigned to this branch.");
    }

    const customer = input.customerId
      ? await tx.customer.findUnique({ where: { id: input.customerId } })
      : await createCustomerTx(tx, actor, branch.id, input.newCustomer!);
    if (!customer) throw notFound("Customer");

    let vehicle = await tx.customerVehicle.findUnique({ where: { registrationNumber: input.vehicle.registrationNumber } });
    if (vehicle && vehicle.customerId !== customer.id) {
      throw conflict("This registration number is registered to a different customer. Verify ownership before proceeding.");
    }
    if (vehicle && input.vehicle.vin && vehicle.vin && vehicle.vin !== input.vehicle.vin) {
      throw conflict("The chassis number does not match the vehicle on record.");
    }
    if (!vehicle) {
      vehicle = await tx.customerVehicle.create({
        data: {
          customerId: customer.id,
          registrationNumber: input.vehicle.registrationNumber,
          vehicleModelId: input.vehicle.vehicleModelId ?? null,
          modelName: input.vehicle.modelName,
          vin: input.vehicle.vin ?? null,
          lastOdometer: input.odometerIn,
        },
      });
    } else {
      if (vehicle.lastOdometer && input.odometerIn < vehicle.lastOdometer) {
        throw invalid(`Odometer reading is lower than the last recorded reading (${vehicle.lastOdometer} km).`);
      }
      await tx.customerVehicle.update({ where: { id: vehicle.id }, data: { lastOdometer: input.odometerIn } });
    }
    const open = await tx.serviceJob.findFirst({
      where: { customerVehicleId: vehicle.id, status: { notIn: ["DELIVERED", "CLOSED", "CANCELLED"] } },
      select: { jobNumber: true },
    });
    if (open) throw conflict(`This vehicle already has an open service job (${open.jobNumber}).`);

    const jobNumber = await nextNumber(tx, "JOB", branch.businessUnit.code);
    const job = await tx.serviceJob.create({
      data: {
        jobNumber,
        branchId: branch.id,
        customerId: customer.id,
        customerVehicleId: vehicle.id,
        serviceAdvisorId: advisorId,
        serviceType: input.serviceType,
        isEmergency: input.isEmergency,
        odometerIn: input.odometerIn,
        fuelLevel: input.fuelLevel,
        reportedProblems: input.reportedProblems,
        vehicleCondition: input.vehicleCondition,
        existingDamage: input.existingDamage,
        accessoriesReceived: input.accessoriesReceived,
        expectedCompletionAt: input.expectedCompletionAt ?? null,
        etaConfidence: "UNKNOWN",
        assignments: { create: { userId: advisorId, role: "ADVISOR", assignedById: actor.userId } },
      },
    });
    await timeline(tx, job.id, {
      stage: "VEHICLE_RECEIVED",
      state: "COMPLETED",
      title: `Your ${vehicle.modelName} was received at ${branch.name}`,
      actor,
      nextExpectedAction: "A technician will inspect your vehicle.",
    });
    await activity(tx, branch.id, job.id, actor.userId, "job.created", { jobNumber });
    await audit(tx, { actorId: actor.userId, action: "service.job.create", entityType: "ServiceJob", entityId: job.id, branchId: branch.id, after: { jobNumber } });
    const full = await lockJob(tx, job.id);
    await queueCustomerMessage(tx, {
      templateKey: "JOB_CREATED",
      businessUnitId: branch.businessUnitId,
      values: templateValues(full),
      email: customer.email,
      customerId: customer.id,
      branchId: branch.id,
      serviceJobId: job.id,
    });
    if (customer.userId) {
      await notifyUsers(tx, [customer.userId], { type: "JOB_CREATED", title: `Service job ${jobNumber} created`, body: `We've received your ${vehicle.modelName}.`, link: `/portal/jobs/${job.id}` });
    }
    return job;
  });
  afterCommit(result.id);
  return result;
}

export async function acknowledgeIntake(actor: Actor, jobId: string) {
  // Customer acknowledgement of the digital job card (customer in portal, or advisor on the customer's behalf at the counter).
  const job = await getJobForActor(actor, jobId);
  if (actor.kind === "STAFF") requirePermission(actor, "service.job.manage");
  if (job.customerAcknowledgedAt) return job;
  return prisma.$transaction(async (tx) => {
    const j = await tx.serviceJob.update({ where: { id: jobId }, data: { customerAcknowledgedAt: new Date() } });
    await audit(tx, { actorId: actor.userId, action: "service.job.acknowledge", entityType: "ServiceJob", entityId: jobId, branchId: job.branchId, after: { channel: actor.kind } });
    return j;
  });
}

export const assignInput = z.object({
  userId: z.string().uuid(),
  role: z.enum(["ADVISOR", "EXAMINER", "MECHANIC", "INSPECTOR", "BILLING"]),
});

const ROLE_FOR_ASSIGNMENT: Record<string, string[]> = {
  ADVISOR: ["SERVICE_ADVISOR", "BRANCH_MANAGER"],
  EXAMINER: ["SERVICE_ADVISOR", "BRANCH_MANAGER", "MECHANIC"],
  MECHANIC: ["MECHANIC"],
  INSPECTOR: ["QUALITY_INSPECTOR", "BRANCH_MANAGER"],
  BILLING: ["BILLING_EXECUTIVE", "BRANCH_MANAGER"],
};

export async function assignStaff(actor: Actor, jobId: string, input: z.infer<typeof assignInput>) {
  requirePermission(actor, input.role === "MECHANIC" ? "service.repair.assign" : "service.job.manage");
  const job = await getJobForActor(actor, jobId);
  assertJobOpen(job);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: {
        id: input.userId,
        isActive: true,
        userType: "STAFF",
        branchAssignments: { some: { branchId: job.branchId } },
        roles: { some: { role: { key: { in: ROLE_FOR_ASSIGNMENT[input.role] } } } },
      },
    });
    if (!user) throw invalid("This employee cannot take that role on jobs at this branch.");
    if (input.role === "ADVISOR") {
      await tx.serviceJobAssignment.updateMany({ where: { jobId, role: "ADVISOR", releasedAt: null }, data: { releasedAt: new Date() } });
      await tx.serviceJob.update({ where: { id: jobId }, data: { serviceAdvisorId: user.id } });
    }
    const exists = await tx.serviceJobAssignment.findFirst({ where: { jobId, userId: user.id, role: input.role, releasedAt: null } });
    if (!exists) await tx.serviceJobAssignment.create({ data: { jobId, userId: user.id, role: input.role, assignedById: actor.userId } });
    await activity(tx, job.branchId, jobId, actor.userId, "job.assigned", { userId: user.id, name: user.name, role: input.role });
    await notifyUsers(tx, [user.id], { type: "JOB_ASSIGNED", title: `Assigned to ${job.jobNumber}`, body: `You were assigned as ${input.role.toLowerCase()}.`, link: `/service/${jobId}`, branchId: job.branchId });
  });
  afterCommit(jobId);
}

export async function releaseAssignment(actor: Actor, jobId: string, assignmentId: string) {
  requirePermission(actor, "service.job.manage");
  const job = await getJobForActor(actor, jobId);
  await prisma.$transaction(async (tx) => {
    const a = await tx.serviceJobAssignment.findFirst({ where: { id: assignmentId, jobId, releasedAt: null } });
    if (!a) throw notFound("Assignment");
    if (a.role === "ADVISOR") throw rule("Assign a new advisor instead of removing the current one.");
    await tx.serviceJobAssignment.update({ where: { id: a.id }, data: { releasedAt: new Date() } });
    await activity(tx, job.branchId, jobId, actor.userId, "job.unassigned", { userId: a.userId, role: a.role });
  });
}

export const cancelInput = z.object({ reason: z.string().trim().min(5).max(500) });

export async function cancelJob(actor: Actor, jobId: string, input: z.infer<typeof cancelInput>) {
  requirePermission(actor, "service.job.manage");
  const job = await getJobForActor(actor, jobId);
  await prisma.$transaction(async (tx) => {
    const j = await lockJob(tx, jobId);
    const issued = await tx.sparePartIssue.count({ where: { request: { jobId } } });
    if (issued) throw rule("Parts have already been issued to this job. Return them to stock and bill or close the job instead.");
    if (!["RECEIVED", "INSPECTION", "AWAITING_APPROVAL"].includes(j.status)) throw rule("Only jobs that have not started repairs can be cancelled.");
    const reservations = await tx.stockReservation.findMany({ where: { status: "ACTIVE", sparePartRequest: { jobId } } });
    const { applyStockChange } = await import("../stock");
    for (const r of reservations) {
      await applyStockChange(tx, { itemId: r.itemId, locationId: r.locationId, branchId: r.branchId, type: "RELEASE", reserved: -r.quantity, performedById: actor.userId, referenceType: "SERVICE_JOB", referenceId: jobId, serviceJobId: jobId, reason: "Job cancelled" });
      await tx.stockReservation.update({ where: { id: r.id }, data: { status: "RELEASED", closedAt: new Date() } });
    }
    await tx.sparePartRequest.updateMany({ where: { jobId, status: { notIn: ["ISSUED", "CANCELLED"] } }, data: { status: "CANCELLED" } });
    await tx.repairTask.updateMany({ where: { jobId, status: { not: "COMPLETED" } }, data: { status: "CANCELLED" } });
    await setJobStatus(tx, j, "CANCELLED", { cancelReason: input.reason, closedAt: new Date() });
    await activity(tx, job.branchId, jobId, actor.userId, "job.cancelled", { reason: input.reason });
    await audit(tx, { actorId: actor.userId, action: "service.job.cancel", entityType: "ServiceJob", entityId: jobId, branchId: job.branchId, after: { reason: input.reason } });
  });
  afterCommit(jobId);
}

export const listJobsQuery = z.object({
  branchId: z.string().uuid().optional(),
  status: z.string().optional(),
  search: z.string().trim().max(60).optional(),
  view: z.enum(["open", "all", "overdue", "blocked", "awaiting_approval"]).default("open"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function listJobs(actor: Actor, q: z.infer<typeof listJobsQuery>) {
  if (!can(actor, "service.view") && !can(actor, "service.view.assigned")) requirePermission(actor, "service.view");
  const where: Prisma.ServiceJobWhereInput = { ...branchFilter(actor, q.branchId) };
  if (!can(actor, "service.view")) {
    where.OR = [{ assignments: { some: { userId: actor.userId, releasedAt: null } } }, { tasks: { some: { assignedMechanicId: actor.userId } } }];
  }
  const now = new Date();
  if (q.view === "open") where.status = { notIn: ["CLOSED", "CANCELLED", "DELIVERED"] };
  if (q.view === "overdue") Object.assign(where, { status: { notIn: ["CLOSED", "CANCELLED", "DELIVERED", "READY_FOR_DELIVERY"] }, etaLatest: { lt: now } });
  if (q.view === "blocked") where.partRequests = { some: { status: { in: ["UNAVAILABLE", "AWAITING_PROCUREMENT"] } } };
  if (q.view === "awaiting_approval") where.status = "AWAITING_APPROVAL";
  if (q.status) where.status = q.status as never;
  if (q.search) {
    const s = q.search.replace(/\s/g, "");
    where.AND = [
      {
        OR: [
          { jobNumber: { contains: q.search, mode: "insensitive" } },
          { customerVehicle: { registrationNumber: { contains: s, mode: "insensitive" } } },
          { customer: { fullName: { contains: q.search, mode: "insensitive" } } },
          { customer: { phone: { contains: s } } },
        ],
      },
    ];
  }
  const [rows, total] = await Promise.all([
    prisma.serviceJob.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true,
        jobNumber: true,
        status: true,
        serviceType: true,
        receivedAt: true,
        etaEarliest: true,
        etaLatest: true,
        etaConfidence: true,
        isEmergency: true,
        branch: { select: { name: true, code: true, timezone: true } },
        customer: { select: { fullName: true } },
        customerVehicle: { select: { registrationNumber: true, modelName: true } },
        serviceAdvisor: { select: { name: true } },
        _count: { select: { partRequests: { where: { status: { in: ["UNAVAILABLE", "AWAITING_PROCUREMENT"] } } } } },
      },
    }),
    prisma.serviceJob.count({ where }),
  ]);
  return { rows, total, page: q.page, pageSize: q.pageSize };
}
