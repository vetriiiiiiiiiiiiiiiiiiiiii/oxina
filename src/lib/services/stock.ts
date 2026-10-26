import type { Prisma, StockMovementType } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { rule } from "@/lib/errors";

export interface StockChange {
  itemId: string;
  locationId: string;
  branchId: string;
  type: StockMovementType;
  /** Change to quantity on hand. */
  onHand?: number;
  /** Change to reserved quantity. */
  reserved?: number;
  performedById: string;
  unitCost?: Prisma.Decimal.Value | null;
  batchNumber?: string | null;
  serialNumber?: string | null;
  reason?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  serviceJobId?: string | null;
}

interface LockedBalance {
  id: string;
  quantityOnHand: number;
  quantityReserved: number;
}

/**
 * Lock (SELECT ... FOR UPDATE) the balance row for an item/location, creating it if needed.
 * Every stock mutation goes through `applyStockChange`, so concurrent requests for the same
 * item/location are serialised on this row lock and can never oversell.
 */
export async function lockBalance(tx: Tx, itemId: string, locationId: string, branchId: string): Promise<LockedBalance> {
  await tx.$executeRaw`
    INSERT INTO "InventoryBalance" ("id", "itemId", "locationId", "branchId", "updatedAt")
    VALUES (gen_random_uuid(), ${itemId}::uuid, ${locationId}::uuid, ${branchId}::uuid, now())
    ON CONFLICT ("itemId", "locationId") DO NOTHING`;
  const rows = await tx.$queryRaw<LockedBalance[]>`
    SELECT "id", "quantityOnHand", "quantityReserved" FROM "InventoryBalance"
    WHERE "itemId" = ${itemId}::uuid AND "locationId" = ${locationId}::uuid
    FOR UPDATE`;
  return rows[0];
}

export async function applyStockChange(tx: Tx, c: StockChange) {
  const dOn = c.onHand ?? 0;
  const dRes = c.reserved ?? 0;
  if (!Number.isInteger(dOn) || !Number.isInteger(dRes)) throw rule("Quantities must be whole numbers.");
  if (dOn === 0 && dRes === 0) throw rule("Stock change has no effect.");

  const bal = await lockBalance(tx, c.itemId, c.locationId, c.branchId);
  const onHandAfter = bal.quantityOnHand + dOn;
  const reservedAfter = bal.quantityReserved + dRes;
  if (onHandAfter < 0) throw rule("Insufficient stock: this would make the quantity on hand negative.");
  if (reservedAfter < 0) throw rule("Reservation release exceeds the reserved quantity.");
  if (reservedAfter > onHandAfter) throw rule("Insufficient available stock for this operation.");

  await tx.inventoryBalance.update({
    where: { id: bal.id },
    data: { quantityOnHand: onHandAfter, quantityReserved: reservedAfter },
  });
  const movement = await tx.stockMovement.create({
    data: {
      itemId: c.itemId,
      locationId: c.locationId,
      branchId: c.branchId,
      type: c.type,
      quantityDelta: dOn,
      reservedDelta: dRes,
      onHandAfter,
      reservedAfter,
      unitCost: c.unitCost ?? null,
      batchNumber: c.batchNumber ?? null,
      serialNumber: c.serialNumber ?? null,
      reason: c.reason ?? null,
      referenceType: c.referenceType ?? null,
      referenceId: c.referenceId ?? null,
      serviceJobId: c.serviceJobId ?? null,
      performedById: c.performedById,
    },
  });
  return { onHandAfter, reservedAfter, available: onHandAfter - reservedAfter, movementId: movement.id };
}

export const available = (b: { quantityOnHand: number; quantityReserved: number }) => b.quantityOnHand - b.quantityReserved;
