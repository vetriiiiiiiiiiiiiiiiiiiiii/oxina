import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { forbidden, invalid, notFound, rule } from "@/lib/errors";
import { assertBranch, branchFilter, can, hasBranch, requirePermission, type Actor } from "@/lib/rbac/actor";
import { audit } from "@/lib/audit";
import { nextNumber } from "@/lib/numbering";
import { D, round2, sum } from "@/lib/money";
import { notifyUsers, branchUsersWithRoles } from "@/lib/notifications";
import { applyStockChange, available } from "./stock";
import { allocateArrivedStock } from "./service/parts";

// ─── Items ───

export const itemInput = z.object({
  businessUnitId: z.string().uuid(),
  partNumber: z.string().trim().toUpperCase().min(2).max(40),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).optional(),
  category: z.enum(["SPARE_PART", "ACCESSORY", "CONSUMABLE", "WARRANTY_REPLACEMENT"]),
  manufacturer: z.string().trim().max(80).optional(),
  defaultSupplierId: z.string().uuid().optional(),
  unit: z.string().trim().max(10).default("pcs"),
  purchaseCost: z.coerce.number().min(0),
  sellingPrice: z.coerce.number().min(0),
  taxRatePercent: z.coerce.number().min(0).max(40).default(18),
  hsnCode: z.string().trim().max(10).optional(),
  compatibleModels: z.array(z.string().trim().max(80)).max(50).default([]),
  warrantyMonths: z.coerce.number().int().min(0).max(120).optional(),
});

function assertUnit(actor: Actor, businessUnitId: string, branchUnits: string[]) {
  if (!actor.allBranches && !branchUnits.includes(businessUnitId)) throw notFound("Business unit");
}

async function actorUnits(actor: Actor) {
  if (actor.allBranches) return [];
  const b = await prisma.branch.findMany({ where: { id: { in: actor.branchIds } }, select: { businessUnitId: true } });
  return [...new Set(b.map((x) => x.businessUnitId))];
}

export async function createItem(actor: Actor, input: z.infer<typeof itemInput>) {
  requirePermission(actor, "inventory.manage");
  assertUnit(actor, input.businessUnitId, await actorUnits(actor));
  return prisma.$transaction(async (tx) => {
    const item = await tx.inventoryItem.create({ data: input });
    await audit(tx, { actorId: actor.userId, action: "inventory.item.create", entityType: "InventoryItem", entityId: item.id, after: { partNumber: item.partNumber } });
    return item;
  });
}

export async function updateItem(actor: Actor, id: string, input: Partial<z.infer<typeof itemInput>>) {
  requirePermission(actor, "inventory.manage");
  const before = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!before) throw notFound("Item");
  assertUnit(actor, before.businessUnitId, await actorUnits(actor));
  // The owning business unit of an item cannot be changed.
  const data = { ...input, businessUnitId: undefined };
  return prisma.$transaction(async (tx) => {
    const item = await tx.inventoryItem.update({ where: { id }, data });
    await audit(tx, { actorId: actor.userId, action: "inventory.item.update", entityType: "InventoryItem", entityId: id, before, after: item });
    return item;
  });
}

export const stockQuery = z.object({
  branchId: z.string().uuid().optional(),
  search: z.string().trim().max(60).optional(),
  category: z.enum(["SPARE_PART", "ACCESSORY", "CONSUMABLE", "WARRANTY_REPLACEMENT"]).optional(),
  lowOnly: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

/** Stock by item & location with available = on hand − reserved. Costs only for permitted roles. */
export async function listStock(actor: Actor, q: z.infer<typeof stockQuery>) {
  requirePermission(actor, "inventory.view");
  const where: Prisma.InventoryBalanceWhereInput = {
    ...branchFilter(actor, q.branchId),
    item: {
      isActive: true,
      ...(q.category ? { category: q.category } : {}),
      ...(q.search ? { OR: [{ name: { contains: q.search, mode: "insensitive" } }, { partNumber: { contains: q.search, mode: "insensitive" } }] } : {}),
    },
  };
  const rows = await prisma.inventoryBalance.findMany({
    where,
    orderBy: [{ item: { name: "asc" } }],
    include: { item: { include: { defaultSupplier: { select: { name: true, leadTimeDays: true } } } }, location: { select: { code: true, name: true } }, branch: { select: { name: true, code: true } } },
    take: 500,
  });
  const showCost = can(actor, "inventory.cost.view");
  const mapped = rows.map((r) => ({
    id: r.id,
    branch: r.branch,
    location: r.location,
    binLocation: r.binLocation,
    item: {
      id: r.item.id, partNumber: r.item.partNumber, name: r.item.name, category: r.item.category, unit: r.item.unit, manufacturer: r.item.manufacturer,
      compatibleModels: r.item.compatibleModels, sellingPrice: r.item.sellingPrice, purchaseCost: showCost ? r.item.purchaseCost : null, supplier: r.item.defaultSupplier?.name ?? null, warrantyMonths: r.item.warrantyMonths,
    },
    onHand: r.quantityOnHand,
    reserved: r.quantityReserved,
    available: available(r),
    minStockLevel: r.minStockLevel,
    reorderQuantity: r.reorderQuantity,
    low: available(r) <= r.minStockLevel,
    updatedAt: r.updatedAt,
  }));
  const filtered = q.lowOnly ? mapped.filter((m) => m.low) : mapped;
  const start = (q.page - 1) * 50;
  return { rows: filtered.slice(start, start + 50), total: filtered.length, page: q.page, pageSize: 50 };
}

/** Reorder recommendations: bring available stock (incl. open POs) up to min + reorder qty. */
export async function reorderRecommendations(actor: Actor, branchId?: string) {
  requirePermission(actor, "inventory.view");
  const rows = await prisma.inventoryBalance.findMany({
    where: { ...branchFilter(actor, branchId), item: { isActive: true } },
    include: { item: { include: { defaultSupplier: true } }, branch: { select: { name: true } } },
  });
  const low = rows.filter((r) => available(r) <= r.minStockLevel);
  const onOrder = await prisma.purchaseOrderLine.findMany({
    where: { itemId: { in: low.map((l) => l.itemId) }, purchaseOrder: { status: { in: ["SUBMITTED", "APPROVED", "PARTIALLY_RECEIVED"] }, ...branchFilter(actor, branchId) } },
    select: { itemId: true, quantity: true, receivedQuantity: true, purchaseOrder: { select: { branchId: true } } },
  });
  const waiting = await prisma.sparePartRequest.groupBy({
    by: ["itemId", "branchId"],
    where: { ...branchFilter(actor, branchId), status: { in: ["UNAVAILABLE", "AWAITING_PROCUREMENT"] } },
    _sum: { quantity: true },
  });
  return low.map((r) => {
    const pending = onOrder.filter((o) => o.itemId === r.itemId && o.purchaseOrder.branchId === r.branchId).reduce((a, o) => a + o.quantity - o.receivedQuantity, 0);
    const shortage = waiting.find((w) => w.itemId === r.itemId && w.branchId === r.branchId)?._sum.quantity ?? 0;
    const target = r.minStockLevel + Math.max(r.reorderQuantity, 1) + shortage;
    return {
      branchId: r.branchId, branch: r.branch.name, itemId: r.itemId, partNumber: r.item.partNumber, name: r.item.name,
      available: available(r), min: r.minStockLevel, onOrder: pending, waitingForJobs: shortage,
      recommendedQty: Math.max(0, target - available(r) - pending), supplier: r.item.defaultSupplier?.name ?? null, supplierId: r.item.defaultSupplierId,
    };
  }).filter((r) => r.recommendedQty > 0);
}

export const balanceSettingsInput = z.object({ minStockLevel: z.coerce.number().int().min(0), reorderQuantity: z.coerce.number().int().min(0), binLocation: z.string().trim().max(30).optional() });

export async function updateBalanceSettings(actor: Actor, balanceId: string, input: z.infer<typeof balanceSettingsInput>) {
  requirePermission(actor, "inventory.manage");
  const b = await prisma.inventoryBalance.findUnique({ where: { id: balanceId } });
  if (!b) throw notFound("Stock record");
  assertBranch(actor, b.branchId, "Stock record");
  return prisma.inventoryBalance.update({ where: { id: balanceId }, data: input });
}

// ─── Adjustments, damage, returns ───

export const adjustInput = z.object({
  itemId: z.string().uuid(),
  locationId: z.string().uuid(),
  type: z.enum(["ADJUSTMENT_IN", "ADJUSTMENT_OUT", "DAMAGED", "RETURN_TO_SUPPLIER", "CUSTOMER_RETURN"]),
  quantity: z.coerce.number().int().min(1).max(100000),
  reason: z.string().trim().min(5, "Explain the reason for this adjustment.").max(500),
  batchNumber: z.string().trim().max(40).optional(),
});

export async function adjustStock(actor: Actor, input: z.infer<typeof adjustInput>) {
  requirePermission(actor, "inventory.manage");
  const loc = await prisma.inventoryLocation.findUnique({ where: { id: input.locationId } });
  if (!loc) throw notFound("Location");
  assertBranch(actor, loc.branchId, "Location");
  const sign = input.type === "ADJUSTMENT_IN" || input.type === "CUSTOMER_RETURN" ? 1 : -1;
  return prisma.$transaction(async (tx) => {
    const res = await applyStockChange(tx, {
      itemId: input.itemId, locationId: loc.id, branchId: loc.branchId, type: input.type, onHand: sign * input.quantity,
      performedById: actor.userId, reason: input.reason, batchNumber: input.batchNumber, referenceType: "ADJUSTMENT",
    });
    await audit(tx, { actorId: actor.userId, action: `inventory.${input.type.toLowerCase()}`, entityType: "InventoryItem", entityId: input.itemId, branchId: loc.branchId, after: { quantity: sign * input.quantity, reason: input.reason } });
    if (sign > 0) await allocateArrivedStock(tx, loc.branchId, [input.itemId], actor.userId);
    return res;
  });
}

// ─── Suppliers ───

export const supplierInput = z.object({
  businessUnitId: z.string().uuid(),
  code: z.string().trim().toUpperCase().min(2).max(20),
  name: z.string().trim().min(2).max(120),
  contactName: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  gstin: z.string().trim().toUpperCase().max(15).optional(),
  addressLine: z.string().trim().max(300).optional(),
  leadTimeDays: z.coerce.number().int().min(0).max(120).default(3),
});

export async function createSupplier(actor: Actor, input: z.infer<typeof supplierInput>) {
  requirePermission(actor, "suppliers.manage");
  assertUnit(actor, input.businessUnitId, await actorUnits(actor));
  return prisma.$transaction(async (tx) => {
    const s = await tx.supplier.create({ data: input });
    await audit(tx, { actorId: actor.userId, action: "supplier.create", entityType: "Supplier", entityId: s.id });
    return s;
  });
}

// ─── Purchase orders & goods receipts ───

export const poInput = z.object({
  branchId: z.string().uuid(),
  supplierId: z.string().uuid(),
  expectedDate: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional(),
  lines: z.array(z.object({ itemId: z.string().uuid(), quantity: z.coerce.number().int().min(1), unitCost: z.coerce.number().min(0) })).min(1).max(100),
});

export async function createPurchaseOrder(actor: Actor, input: z.infer<typeof poInput>) {
  requirePermission(actor, "purchases.manage");
  assertBranch(actor, input.branchId, "Branch");
  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: input.branchId }, include: { businessUnit: true } });
    const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, businessUnitId: branch.businessUnitId, isActive: true } });
    if (!supplier) throw invalid("Supplier not found for this business.");
    const items = await tx.inventoryItem.count({ where: { id: { in: input.lines.map((l) => l.itemId) }, businessUnitId: branch.businessUnitId } });
    if (items !== new Set(input.lines.map((l) => l.itemId)).size) throw invalid("One or more items are not valid for this business.");
    const total = round2(sum(input.lines.map((l) => D(l.unitCost).times(l.quantity))));
    const po = await tx.purchaseOrder.create({
      data: {
        poNumber: await nextNumber(tx, "PO", branch.businessUnit.code),
        branchId: branch.id, supplierId: supplier.id, expectedDate: input.expectedDate, notes: input.notes, totalAmount: total, createdById: actor.userId,
        lines: { create: input.lines },
      },
    });
    await audit(tx, { actorId: actor.userId, action: "po.create", entityType: "PurchaseOrder", entityId: po.id, branchId: branch.id, after: { poNumber: po.poNumber, total } });
    return po;
  });
}

export async function setPurchaseOrderStatus(actor: Actor, poId: string, to: "SUBMITTED" | "APPROVED" | "CANCELLED") {
  requirePermission(actor, to === "APPROVED" ? "purchases.approve" : "purchases.manage");
  const po = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
  if (!po) throw notFound("Purchase order");
  assertBranch(actor, po.branchId, "Purchase order");
  const allowed: Record<string, string[]> = { SUBMITTED: ["DRAFT"], APPROVED: ["SUBMITTED"], CANCELLED: ["DRAFT", "SUBMITTED", "APPROVED"] };
  if (!allowed[to].includes(po.status)) throw rule(`A ${po.status.toLowerCase()} purchase order cannot be ${to.toLowerCase()}.`);
  if (to === "APPROVED" && po.createdById === actor.userId && !actor.allBranches) throw forbidden("Purchase orders must be approved by someone other than the creator.");
  return prisma.$transaction(async (tx) => {
    const r = await tx.purchaseOrder.update({ where: { id: poId }, data: { status: to, ...(to === "APPROVED" ? { approvedById: actor.userId, approvedAt: new Date() } : {}) } });
    await audit(tx, { actorId: actor.userId, action: `po.${to.toLowerCase()}`, entityType: "PurchaseOrder", entityId: poId, branchId: po.branchId });
    return r;
  });
}

export const grnInput = z.object({
  branchId: z.string().uuid(),
  supplierId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().optional(),
  locationId: z.string().uuid(),
  supplierInvoice: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(1000).optional(),
  lines: z.array(z.object({ itemId: z.string().uuid(), poLineId: z.string().uuid().optional(), quantity: z.coerce.number().int().min(1), unitCost: z.coerce.number().min(0), batchNumber: z.string().trim().max(40).optional() })).min(1).max(100),
});

/** Goods receipt: increases stock, updates PO progress, then serves waiting service jobs. */
export async function receiveGoods(actor: Actor, input: z.infer<typeof grnInput>) {
  requirePermission(actor, "purchases.manage", "inventory.manage");
  assertBranch(actor, input.branchId, "Branch");
  const res = await prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: input.branchId }, include: { businessUnit: true } });
    const loc = await tx.inventoryLocation.findFirst({ where: { id: input.locationId, branchId: branch.id, isActive: true } });
    if (!loc) throw invalid("Choose a stock location in this branch.");
    let po: Prisma.PurchaseOrderGetPayload<{ include: { lines: true } }> | null = null;
    if (input.purchaseOrderId) {
      await tx.$queryRaw`SELECT 1 FROM "PurchaseOrder" WHERE "id" = ${input.purchaseOrderId}::uuid FOR UPDATE`;
      po = await tx.purchaseOrder.findFirst({ where: { id: input.purchaseOrderId, branchId: branch.id }, include: { lines: true } });
      if (!po) throw invalid("Purchase order not found in this branch.");
      if (!["APPROVED", "PARTIALLY_RECEIVED"].includes(po.status)) throw rule("Only approved purchase orders can be received.");
      if (po.supplierId !== input.supplierId) throw invalid("Supplier does not match the purchase order.");
    }
    const grn = await tx.goodsReceipt.create({
      data: {
        grnNumber: await nextNumber(tx, "GRN", branch.businessUnit.code),
        branchId: branch.id, supplierId: input.supplierId, purchaseOrderId: po?.id, locationId: loc.id, supplierInvoice: input.supplierInvoice, notes: input.notes, receivedById: actor.userId,
      },
    });
    for (const l of input.lines) {
      if (po) {
        const pl = po.lines.find((x) => x.id === l.poLineId) ?? po.lines.find((x) => x.itemId === l.itemId);
        if (!pl) throw invalid("Item is not on the purchase order.");
        if (pl.receivedQuantity + l.quantity > pl.quantity) throw invalid("Received quantity exceeds the ordered quantity.");
        await tx.purchaseOrderLine.update({ where: { id: pl.id }, data: { receivedQuantity: { increment: l.quantity } } });
        l.poLineId = pl.id;
      }
      await tx.goodsReceiptLine.create({ data: { goodsReceiptId: grn.id, itemId: l.itemId, poLineId: l.poLineId, quantity: l.quantity, unitCost: l.unitCost, batchNumber: l.batchNumber } });
      await applyStockChange(tx, { itemId: l.itemId, locationId: loc.id, branchId: branch.id, type: "RECEIPT", onHand: l.quantity, unitCost: l.unitCost, batchNumber: l.batchNumber, performedById: actor.userId, referenceType: "GRN", referenceId: grn.id });
    }
    if (po) {
      const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
      const done = lines.every((x) => x.receivedQuantity >= x.quantity);
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: done ? "RECEIVED" : "PARTIALLY_RECEIVED" } });
    }
    await audit(tx, { actorId: actor.userId, action: "grn.create", entityType: "GoodsReceipt", entityId: grn.id, branchId: branch.id, after: { grnNumber: grn.grnNumber, lines: input.lines.length } });
    const jobs = await allocateArrivedStock(tx, branch.id, input.lines.map((l) => l.itemId), actor.userId);
    return { grn, jobs };
  });
  const { publishJobUpdate } = await import("@/lib/realtime");
  res.jobs.forEach(publishJobUpdate);
  return res.grn;
}

// ─── Inter-branch transfers ───

export const transferInput = z.object({
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  notes: z.string().trim().max(500).optional(),
  sparePartRequestId: z.string().uuid().optional(),
  lines: z.array(z.object({ itemId: z.string().uuid(), quantity: z.coerce.number().int().min(1) })).min(1).max(50),
});

export async function createTransfer(actor: Actor, input: z.infer<typeof transferInput>) {
  requirePermission(actor, "inventory.transfer");
  const [from, to] = await Promise.all([
    prisma.inventoryLocation.findUnique({ where: { id: input.fromLocationId }, include: { branch: true } }),
    prisma.inventoryLocation.findUnique({ where: { id: input.toLocationId }, include: { branch: { include: { businessUnit: true } } } }),
  ]);
  if (!from || !to) throw notFound("Location");
  // The requesting side must be in scope; the source branch must be one the actor can see too.
  if (!hasBranch(actor, to.branchId) && !hasBranch(actor, from.branchId)) throw notFound("Location");
  if (from.id === to.id) throw invalid("Source and destination must differ.");
  if (from.branch.businessUnitId !== to.branch.businessUnitId) throw invalid("Transfers are limited to branches of the same business.");
  return prisma.$transaction(async (tx) => {
    const t = await tx.stockTransfer.create({
      data: {
        transferNumber: await nextNumber(tx, "TRF", to.branch.businessUnit.code),
        fromBranchId: from.branchId, toBranchId: to.branchId, fromLocationId: from.id, toLocationId: to.id, notes: input.notes, requestedById: actor.userId,
        lines: { create: input.lines },
      },
    });
    if (input.sparePartRequestId) {
      await tx.sparePartRequest.updateMany({ where: { id: input.sparePartRequestId, branchId: to.branchId }, data: { transferId: t.id, status: "AWAITING_PROCUREMENT" } });
    }
    const team = await branchUsersWithRoles(tx, from.branchId, ["WAREHOUSE_EXECUTIVE", "BRANCH_MANAGER"]);
    await notifyUsers(tx, team, { type: "TRANSFER_REQUESTED", title: `Transfer request ${t.transferNumber}`, body: `${to.branch.name} requested stock.`, link: "/inventory/transfers", branchId: from.branchId });
    await audit(tx, { actorId: actor.userId, action: "transfer.create", entityType: "StockTransfer", entityId: t.id, branchId: to.branchId });
    return t;
  });
}

/** Dispatch: stock leaves the source (TRANSFER_OUT). Receive: arrives at destination (TRANSFER_IN). */
export async function progressTransfer(actor: Actor, transferId: string, action: "APPROVE" | "DISPATCH" | "RECEIVE" | "CANCEL") {
  requirePermission(actor, "inventory.transfer");
  const t = await prisma.stockTransfer.findUnique({ where: { id: transferId }, include: { lines: true } });
  if (!t) throw notFound("Transfer");
  const sourceSide = action === "APPROVE" || action === "DISPATCH";
  assertBranch(actor, sourceSide ? t.fromBranchId : action === "RECEIVE" ? t.toBranchId : (hasBranch(actor, t.fromBranchId) ? t.fromBranchId : t.toBranchId), "Transfer");
  const res = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "StockTransfer" WHERE "id" = ${transferId}::uuid FOR UPDATE`;
    const cur = await tx.stockTransfer.findUniqueOrThrow({ where: { id: transferId } });
    const need: Record<string, string> = { APPROVE: "REQUESTED", DISPATCH: "APPROVED", RECEIVE: "DISPATCHED" };
    if (action === "CANCEL") {
      if (!["REQUESTED", "APPROVED"].includes(cur.status)) throw rule("Dispatched transfers cannot be cancelled; receive and return them instead.");
      await tx.stockTransfer.update({ where: { id: transferId }, data: { status: "CANCELLED" } });
    } else {
      if (cur.status !== need[action]) throw rule(`Transfer is ${cur.status.toLowerCase()}; cannot ${action.toLowerCase()}.`);
      if (action === "APPROVE") await tx.stockTransfer.update({ where: { id: transferId }, data: { status: "APPROVED", approvedById: actor.userId } });
      if (action === "DISPATCH") {
        for (const l of t.lines) {
          await applyStockChange(tx, { itemId: l.itemId, locationId: t.fromLocationId, branchId: t.fromBranchId, type: "TRANSFER_OUT", onHand: -l.quantity, performedById: actor.userId, referenceType: "TRANSFER", referenceId: t.id });
        }
        await tx.stockTransfer.update({ where: { id: transferId }, data: { status: "DISPATCHED", dispatchedById: actor.userId, dispatchedAt: new Date() } });
      }
      if (action === "RECEIVE") {
        for (const l of t.lines) {
          await applyStockChange(tx, { itemId: l.itemId, locationId: t.toLocationId, branchId: t.toBranchId, type: "TRANSFER_IN", onHand: l.quantity, performedById: actor.userId, referenceType: "TRANSFER", referenceId: t.id });
          await tx.stockTransferLine.update({ where: { id: l.id }, data: { receivedQuantity: l.quantity } });
        }
        await tx.stockTransfer.update({ where: { id: transferId }, data: { status: "RECEIVED", receivedById: actor.userId, receivedAt: new Date() } });
      }
    }
    await audit(tx, { actorId: actor.userId, action: `transfer.${action.toLowerCase()}`, entityType: "StockTransfer", entityId: t.id, branchId: sourceSide ? t.fromBranchId : t.toBranchId });
    return action === "RECEIVE" ? allocateArrivedStock(tx, t.toBranchId, t.lines.map((l) => l.itemId), actor.userId) : [];
  });
  const { publishJobUpdate } = await import("@/lib/realtime");
  res.forEach(publishJobUpdate);
}

// ─── Stock audits ───

export async function startStockAudit(actor: Actor, locationId: string) {
  requirePermission(actor, "inventory.manage");
  const loc = await prisma.inventoryLocation.findUnique({ where: { id: locationId } });
  if (!loc) throw notFound("Location");
  assertBranch(actor, loc.branchId, "Location");
  const open = await prisma.stockAudit.findFirst({ where: { locationId, status: "IN_PROGRESS" } });
  if (open) return open;
  return prisma.stockAudit.create({ data: { branchId: loc.branchId, locationId, startedById: actor.userId } });
}

export const auditCountInput = z.object({ counts: z.array(z.object({ itemId: z.string().uuid(), countedQty: z.coerce.number().int().min(0) })).min(1) });

/** Complete an audit: each variance becomes an ADJUSTMENT movement with the audit as reference. */
export async function completeStockAudit(actor: Actor, auditId: string, input: z.infer<typeof auditCountInput>) {
  requirePermission(actor, "inventory.manage");
  const a = await prisma.stockAudit.findUnique({ where: { id: auditId } });
  if (!a) throw notFound("Stock audit");
  assertBranch(actor, a.branchId, "Stock audit");
  if (a.status !== "IN_PROGRESS") throw rule("This audit is already complete.");
  return prisma.$transaction(async (tx: Tx) => {
    const results = [];
    for (const c of input.counts) {
      const bal = await tx.inventoryBalance.findUnique({ where: { itemId_locationId: { itemId: c.itemId, locationId: a.locationId } } });
      const system = bal?.quantityOnHand ?? 0;
      await tx.stockAuditLine.create({ data: { auditId, itemId: c.itemId, systemQty: system, countedQty: c.countedQty } });
      const diff = c.countedQty - system;
      if (diff !== 0) {
        await applyStockChange(tx, { itemId: c.itemId, locationId: a.locationId, branchId: a.branchId, type: diff > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", onHand: diff, performedById: actor.userId, reason: "Stock audit variance", referenceType: "AUDIT", referenceId: auditId });
      }
      results.push({ itemId: c.itemId, system, counted: c.countedQty, variance: diff });
    }
    await tx.stockAudit.update({ where: { id: auditId }, data: { status: "COMPLETED", completedAt: new Date() } });
    await audit(tx, { actorId: actor.userId, action: "stock_audit.complete", entityType: "StockAudit", entityId: auditId, branchId: a.branchId, after: { variances: results.filter((r) => r.variance !== 0).length } });
    return results;
  });
}

export async function stockMovements(actor: Actor, q: { branchId?: string; itemId?: string }) {
  requirePermission(actor, "inventory.view");
  return prisma.stockMovement.findMany({
    where: { ...branchFilter(actor, q.branchId), ...(q.itemId ? { itemId: q.itemId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { item: { select: { partNumber: true, name: true } }, location: { select: { code: true } }, performedBy: { select: { name: true } }, serviceJob: { select: { id: true, jobNumber: true } } },
  });
}
