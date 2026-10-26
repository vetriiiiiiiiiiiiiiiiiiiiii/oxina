import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { forbidden, invalid, notFound, rule } from "@/lib/errors";
import { assertBranch, branchFilter, can, requirePermission, type Actor } from "@/lib/rbac/actor";
import { nextNumber } from "@/lib/numbering";
import { branchUsersWithRoles, notifyUsers, queueCustomerMessage } from "@/lib/notifications";
import { PART_UNAVAILABLE_CUSTOMER_MESSAGE } from "@/lib/service/stages";
import { applyStockChange, available } from "../stock";
import { activity, afterCommit, assertJobOpen, getJobForActor, lockJob, setJobStatus, templateValues, timeline } from "./common";
import { recalcEta } from "./eta";
import { refreshTaskReadiness } from "./repairs";

/** Pick the location in the branch that can best serve an item (service store first, most available). */
async function pickLocation(tx: Tx, branchId: string, itemId: string) {
  const balances = await tx.inventoryBalance.findMany({
    where: { branchId, itemId, location: { isActive: true, type: { in: ["SERVICE_STORE", "WAREHOUSE"] } } },
    include: { location: true },
  });
  const best = balances.sort((a, b) => available(b) - available(a) || (a.location.type === "SERVICE_STORE" ? -1 : 1))[0];
  if (best) return best.locationId;
  const loc = await tx.inventoryLocation.findFirst({ where: { branchId, isActive: true, type: { in: ["SERVICE_STORE", "WAREHOUSE"] } }, orderBy: { type: "asc" } });
  if (!loc) throw rule("This branch has no active stock location. Add one in Inventory → Locations.");
  return loc.id;
}

/**
 * Try to reserve stock for a request inside the caller's transaction.
 * The balance row is locked, so two concurrent requests can never reserve the same units.
 */
async function tryReserve(tx: Tx, req: { id: string; itemId: string; locationId: string; branchId: string; quantity: number; jobId: string }, actorId: string) {
  const bal = await tx.$queryRaw<{ onhand: number; reserved: number }[]>`
    SELECT "quantityOnHand" AS onhand, "quantityReserved" AS reserved FROM "InventoryBalance"
    WHERE "itemId" = ${req.itemId}::uuid AND "locationId" = ${req.locationId}::uuid FOR UPDATE`;
  const avail = bal[0] ? bal[0].onhand - bal[0].reserved : 0;
  if (avail < req.quantity) return false;
  await applyStockChange(tx, {
    itemId: req.itemId, locationId: req.locationId, branchId: req.branchId, type: "RESERVE", reserved: req.quantity,
    performedById: actorId, referenceType: "SPARE_PART_REQUEST", referenceId: req.id, serviceJobId: req.jobId,
  });
  await tx.stockReservation.create({
    data: { itemId: req.itemId, locationId: req.locationId, branchId: req.branchId, quantity: req.quantity, sparePartRequestId: req.id, createdById: actorId },
  });
  return true;
}

/**
 * Stage 4 — billing / parts verification. For each approved part on the job's estimates
 * create a spare-part request; reserve if available, otherwise record a shortage,
 * block dependent tasks, notify the team and the customer.
 */
export async function verifyPartsAndRequest(actor: Actor, jobId: string) {
  requirePermission(actor, "service.parts.request");
  const job = await getJobForActor(actor, jobId);
  assertJobOpen(job);
  const summary = { reserved: 0, unavailable: 0 };
  await prisma.$transaction(async (tx) => {
    const j = await lockJob(tx, jobId);
    if (!["APPROVED", "PARTS_PENDING", "IN_REPAIR", "QUALITY_CHECK", "AWAITING_APPROVAL"].includes(j.status)) {
      throw rule("Parts can be requested once work has been approved.");
    }
    const lines = await tx.estimateLineItem.findMany({
      where: { estimate: { jobId }, type: "PART", approvalStatus: "APPROVED", inventoryItemId: { not: null }, partRequest: null, repairTask: { status: { not: "CANCELLED" } } },
      include: { inventoryItem: true },
    });
    if (!lines.length) throw rule("All approved parts already have requests.");
    const mechanics = await tx.serviceJobAssignment.findFirst({ where: { jobId, role: "MECHANIC", releasedAt: null } });
    const shortages: string[] = [];
    for (const l of lines) {
      const locationId = await pickLocation(tx, job.branchId, l.inventoryItemId!);
      const bal = await tx.inventoryBalance.findUnique({ where: { itemId_locationId: { itemId: l.inventoryItemId!, locationId } } });
      const task = l.repairTaskId ? await tx.repairTask.findUnique({ where: { id: l.repairTaskId } }) : null;
      const req = await tx.sparePartRequest.create({
        data: {
          requestNumber: await nextNumber(tx, "SPR", job.branch.businessUnit.code),
          jobId,
          branchId: job.branchId,
          repairTaskId: l.repairTaskId,
          estimateLineId: l.id,
          itemId: l.inventoryItemId!,
          locationId,
          quantity: l.quantity,
          priority: task?.isSafetyCritical ? "HIGH" : "NORMAL",
          requestedById: actor.userId,
          assignedMechanicId: task?.assignedMechanicId ?? mechanics?.userId ?? null,
          availableAtRequest: bal ? available(bal) : 0,
        },
      });
      if (await tryReserve(tx, { ...req, jobId }, actor.userId)) {
        await tx.sparePartRequest.update({ where: { id: req.id }, data: { status: "RESERVED" } });
        summary.reserved++;
      } else {
        await tx.sparePartRequest.update({ where: { id: req.id }, data: { status: "UNAVAILABLE" } });
        shortages.push(l.inventoryItem!.name);
        summary.unavailable++;
      }
    }
    await refreshTaskReadiness(tx, jobId, actor.userId);
    await timeline(tx, jobId, {
      stage: "PARTS_CHECKED",
      state: "COMPLETED",
      title: shortages.length ? "Spare-part availability checked — some parts need to be arranged" : "All required spare parts are available",
      actor,
    });
    const warehouse = await branchUsersWithRoles(tx, job.branchId, ["WAREHOUSE_EXECUTIVE"]);
    if (summary.reserved) {
      await notifyUsers(tx, warehouse, { type: "PARTS_REQUESTED", title: `Parts to pick — ${j.jobNumber}`, body: `${summary.reserved} reserved part request(s) are waiting to be picked.`, link: "/inventory/requests", branchId: job.branchId });
    }
    if (shortages.length) {
      if (j.status !== "PARTS_PENDING" && ["APPROVED", "IN_REPAIR"].includes(j.status)) await setJobStatus(tx, j, "PARTS_PENDING");
      await recalcEta(tx, jobId);
      await timeline(tx, jobId, {
        stage: "PARTS_BEING_ARRANGED",
        state: "BLOCKED",
        title: "Parts being arranged",
        customerNote: PART_UNAVAILABLE_CUSTOMER_MESSAGE,
        nextExpectedAction: "Your service advisor will update you with the expected availability.",
      });
      const managers = await branchUsersWithRoles(tx, job.branchId, ["BRANCH_MANAGER", "WAREHOUSE_EXECUTIVE"]);
      await notifyUsers(tx, [...managers, j.serviceAdvisorId], { type: "PART_UNAVAILABLE", title: `Part shortage — ${j.jobNumber}`, body: `Unavailable: ${shortages.join(", ")}. Record procurement and an expected date.`, link: "/inventory/requests?view=shortages", branchId: job.branchId });
      const fresh = await lockJob(tx, jobId);
      await queueCustomerMessage(tx, {
        templateKey: "PART_UNAVAILABLE",
        businessUnitId: job.branch.businessUnitId,
        values: templateValues(fresh, { part_name: shortages.join(", ") }),
        email: job.customer.email,
        customerId: job.customerId,
        branchId: job.branchId,
        serviceJobId: jobId,
      });
      if (job.customer.userId) await notifyUsers(tx, [job.customer.userId], { type: "PART_UNAVAILABLE", title: "Parts being arranged", body: PART_UNAVAILABLE_CUSTOMER_MESSAGE, link: `/portal/jobs/${jobId}` });
    } else {
      await recalcEta(tx, jobId);
    }
    await activity(tx, job.branchId, jobId, actor.userId, "parts.verified", summary);
  });
  afterCommit(jobId);
  return summary;
}

async function loadRequest(actor: Actor, requestId: string) {
  const req = await prisma.sparePartRequest.findUnique({ where: { id: requestId } });
  if (!req) throw notFound("Part request");
  assertBranch(actor, req.branchId, "Part request");
  return req;
}

/** Warehouse picking workflow: RESERVED → PICKING → PICKED. */
export async function advancePicking(actor: Actor, requestId: string, to: "PICKING" | "PICKED") {
  requirePermission(actor, "inventory.issue");
  const req = await loadRequest(actor, requestId);
  const from = to === "PICKING" ? ["RESERVED"] : ["RESERVED", "PICKING"];
  const n = await prisma.sparePartRequest.updateMany({ where: { id: requestId, status: { in: from as never }, version: req.version }, data: { status: to, version: { increment: 1 } } });
  if (!n.count) throw rule("This request was updated by someone else or is not ready for that step. Refresh and try again.");
  await prisma.internalActivityLog.create({ data: { branchId: req.branchId, jobId: req.jobId, actorId: actor.userId, action: `parts.${to.toLowerCase()}`, details: { requestId } } });
  afterCommit(req.jobId);
}

export const issueInput = z.object({ receivedByMechanicId: z.string().uuid() });

/** Stage 5 — issue a reserved part to a mechanic. Exactly once per request (unique constraint). */
export async function issuePart(actor: Actor, requestId: string, input: z.infer<typeof issueInput>) {
  requirePermission(actor, "inventory.issue");
  const req = await loadRequest(actor, requestId);
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "SparePartRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE`;
    if (!["RESERVED", "PICKING", "PICKED"].includes(locked[0].status)) {
      throw rule(locked[0].status === "ISSUED" ? "This part has already been issued." : "The part must be reserved before it can be issued.");
    }
    const mech = await tx.user.findFirst({
      where: { id: input.receivedByMechanicId, isActive: true, branchAssignments: { some: { branchId: req.branchId } }, roles: { some: { role: { key: "MECHANIC" } } } },
    });
    if (!mech) throw invalid("Select a mechanic assigned to this branch.");
    const reservation = await tx.stockReservation.findUnique({ where: { sparePartRequestId: requestId } });
    if (!reservation || reservation.status !== "ACTIVE") throw rule("No active reservation for this request.");
    const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: req.itemId } });
    const mv = await applyStockChange(tx, {
      itemId: req.itemId, locationId: req.locationId, branchId: req.branchId, type: "ISSUE",
      onHand: -req.quantity, reserved: -req.quantity, unitCost: item.purchaseCost, performedById: actor.userId,
      referenceType: "SPARE_PART_REQUEST", referenceId: requestId, serviceJobId: req.jobId,
    });
    await tx.stockReservation.update({ where: { id: reservation.id }, data: { status: "CONSUMED", closedAt: new Date() } });
    const line = req.estimateLineId ? await tx.estimateLineItem.findUnique({ where: { id: req.estimateLineId } }) : null;
    const issue = await tx.sparePartIssue.create({
      data: { requestId, itemId: req.itemId, locationId: req.locationId, quantity: req.quantity, unitPrice: line?.unitPrice ?? item.sellingPrice, issuedById: actor.userId, receivedByMechanicId: mech.id },
    });
    if (item.warrantyMonths) {
      const start = new Date();
      const end = new Date(start);
      end.setMonth(end.getMonth() + item.warrantyMonths);
      const job = await tx.serviceJob.findUniqueOrThrow({ where: { id: req.jobId }, select: { customerVehicleId: true } });
      await tx.warranty.create({ data: { type: "PART", inventoryItemId: item.id, sparePartIssueId: issue.id, customerVehicleId: job.customerVehicleId, startDate: start, endDate: end, terms: `${item.warrantyMonths}-month part warranty` } });
    }
    await tx.sparePartRequest.update({ where: { id: requestId }, data: { status: "ISSUED", version: { increment: 1 } } });
    await activity(tx, req.branchId, req.jobId, actor.userId, "parts.issued", { requestId, itemId: req.itemId, quantity: req.quantity, mechanic: mech.name, movementId: mv.movementId });

    const open = await tx.sparePartRequest.count({ where: { jobId: req.jobId, status: { notIn: ["ISSUED", "CANCELLED"] } } });
    if (!open) await timeline(tx, req.jobId, { stage: "PARTS_ISSUED", state: "COMPLETED", title: "All required parts have been issued to the technician", actor });
    await refreshTaskReadiness(tx, req.jobId, actor.userId);
    await recalcEta(tx, req.jobId);
    await notifyUsers(tx, [mech.id], { type: "PART_ISSUED", title: `Part issued: ${item.name}`, body: `Qty ${req.quantity} for job.`, link: `/service/${req.jobId}`, branchId: req.branchId });
  });
  afterCommit(req.jobId);
}

export const procurementInput = z.object({
  expectedAvailableAt: z.coerce.date().optional(),
  note: z.string().trim().max(500).optional(),
  purchaseOrderId: z.string().uuid().optional(),
  transferId: z.string().uuid().optional(),
});

/** Record how and when a missing part will arrive. The ETA uses this date; without it no completion time is promised. */
export async function recordProcurement(actor: Actor, requestId: string, input: z.infer<typeof procurementInput>) {
  if (!can(actor, "inventory.manage") && !can(actor, "service.job.manage")) throw forbidden();
  const req = await loadRequest(actor, requestId);
  if (!["UNAVAILABLE", "AWAITING_PROCUREMENT"].includes(req.status)) throw rule("Procurement is only recorded for unavailable parts.");
  if (input.expectedAvailableAt && input.expectedAvailableAt < new Date(Date.now() - 60_000)) throw invalid("Expected availability must be in the future.");
  await prisma.$transaction(async (tx) => {
    if (input.purchaseOrderId) {
      const po = await tx.purchaseOrder.findFirst({ where: { id: input.purchaseOrderId, branchId: req.branchId } });
      if (!po) throw invalid("Purchase order not found in this branch.");
    }
    await tx.sparePartRequest.update({
      where: { id: requestId },
      data: {
        status: "AWAITING_PROCUREMENT",
        expectedAvailableAt: input.expectedAvailableAt ?? null,
        procurementNote: input.note ?? null,
        purchaseOrderId: input.purchaseOrderId ?? undefined,
        transferId: input.transferId ?? undefined,
        version: { increment: 1 },
      },
    });
    await activity(tx, req.branchId, req.jobId, actor.userId, "parts.procurement", { requestId, ...input });
    const { changed, formatted } = await recalcEta(tx, req.jobId);
    const job = await lockJob(tx, req.jobId);
    if (input.expectedAvailableAt) {
      await timeline(tx, req.jobId, {
        stage: "PARTS_BEING_ARRANGED",
        state: "BLOCKED",
        title: "Spare-part arrival date confirmed",
        customerNote: formatted ? `Based on the expected part arrival, your vehicle should be ready by ${formatted}.` : null,
        actor,
      });
      if (changed) {
        await queueCustomerMessage(tx, { templateKey: "ETA_CHANGED", businessUnitId: job.branch.businessUnitId, values: templateValues(job), email: job.customer.email, customerId: job.customerId, branchId: job.branchId, serviceJobId: job.id });
      }
    }
  });
  afterCommit(req.jobId);
}

/**
 * Called after stock arrives (GRN or transfer receipt): reserve for waiting requests in FIFO
 * order (urgent first) and unblock their tasks.
 */
export async function allocateArrivedStock(tx: Tx, branchId: string, itemIds: string[], actorId: string) {
  const waiting = await tx.sparePartRequest.findMany({
    where: { branchId, itemId: { in: itemIds }, status: { in: ["UNAVAILABLE", "AWAITING_PROCUREMENT"] } },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  const touchedJobs = new Set<string>();
  for (const r of waiting) {
    // The part may have arrived at another location of the branch.
    const loc = await pickLocation(tx, branchId, r.itemId);
    if (loc !== r.locationId) await tx.sparePartRequest.update({ where: { id: r.id }, data: { locationId: loc } });
    if (await tryReserve(tx, { ...r, locationId: loc }, actorId)) {
      await tx.sparePartRequest.update({ where: { id: r.id }, data: { status: "RESERVED", version: { increment: 1 } } });
      touchedJobs.add(r.jobId);
    }
  }
  for (const jobId of touchedJobs) {
    const job = await tx.serviceJob.findUniqueOrThrow({ where: { id: jobId } });
    const stillMissing = await tx.sparePartRequest.count({ where: { jobId, status: { in: ["UNAVAILABLE", "AWAITING_PROCUREMENT"] } } });
    if (!stillMissing) {
      await timeline(tx, jobId, { stage: "PARTS_BEING_ARRANGED", state: "COMPLETED", title: "Required parts have arrived" });
      if (job.status === "PARTS_PENDING") {
        const started = await tx.repairTask.count({ where: { jobId, status: { in: ["IN_PROGRESS", "PAUSED", "COMPLETED"] } } });
        await setJobStatus(tx, job, started ? "IN_REPAIR" : "APPROVED");
      }
    }
    await refreshTaskReadiness(tx, jobId, actorId);
    await recalcEta(tx, jobId);
    const warehouse = await branchUsersWithRoles(tx, branchId, ["WAREHOUSE_EXECUTIVE"]);
    await notifyUsers(tx, [...warehouse, job.serviceAdvisorId], { type: "PART_RECEIVED", title: `Parts arrived — ${job.jobNumber}`, body: "Waiting part requests were reserved and are ready to pick.", link: "/inventory/requests", branchId });
  }
  return [...touchedJobs];
}

export const requestQuery = z.object({
  branchId: z.string().uuid().optional(),
  view: z.enum(["queue", "shortages", "issued", "all"]).default("queue"),
});

export async function listPartRequests(actor: Actor, q: z.infer<typeof requestQuery>) {
  if (!can(actor, "inventory.view") && !can(actor, "service.view")) throw forbidden();
  const status =
    q.view === "queue" ? { in: ["REQUESTED", "RESERVED", "PICKING", "PICKED"] } :
    q.view === "shortages" ? { in: ["UNAVAILABLE", "AWAITING_PROCUREMENT"] } :
    q.view === "issued" ? { equals: "ISSUED" } : undefined;
  return prisma.sparePartRequest.findMany({
    where: { ...branchFilter(actor, q.branchId), ...(status ? { status: status as never } : {}) },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 200,
    include: {
      item: { select: { partNumber: true, name: true, unit: true } },
      location: { select: { code: true, name: true } },
      job: { select: { id: true, jobNumber: true, customerVehicle: { select: { registrationNumber: true, modelName: true } } } },
      repairTask: { select: { title: true, status: true } },
      requestedBy: { select: { name: true } },
      assignedMechanic: { select: { id: true, name: true } },
      issue: { include: { issuedBy: { select: { name: true } }, receivedBy: { select: { name: true } } } },
      branch: { select: { name: true } },
    },
  });
}
