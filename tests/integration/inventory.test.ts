import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildFixture, expectCode, jobWithTasks, sendAndApprove, type Fixture } from "../fixtures";
import { issuePart, verifyPartsAndRequest } from "@/lib/services/service/parts";
import { applyStockChange } from "@/lib/services/stock";
import { createTransfer, progressTransfer } from "@/lib/services/inventory";

let f: Fixture;
beforeAll(async () => {
  f = await buildFixture();
});

const bal = (itemId: string, locationId: string) => prisma.inventoryBalance.findUniqueOrThrow({ where: { itemId_locationId: { itemId, locationId } } });

describe("6. Concurrent inventory requests cannot issue more parts than available", () => {
  it("reserves for only one of two simultaneous jobs competing for the same stock", async () => {
    // 4 pads on hand; each job needs 3.
    const j1 = await jobWithTasks(f, { tasks: [{ title: "Pads 1", labour: 100, parts: [{ itemId: f.pad.id, quantity: 3 }] }] });
    const j2 = await jobWithTasks(f, { customerId: f.c2.id, tasks: [{ title: "Pads 2", labour: 100, parts: [{ itemId: f.pad.id, quantity: 3 }] }] });
    await sendAndApprove(f, j1.id);
    await sendAndApprove(f, j2.id, f.actors.cust2);
    const results = await Promise.allSettled([verifyPartsAndRequest(f.actors.billA, j1.id), verifyPartsAndRequest(f.actors.billA, j2.id)]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const reqs = await prisma.sparePartRequest.findMany({ where: { itemId: f.pad.id, jobId: { in: [j1.id, j2.id] } } });
    expect(reqs.filter((r) => r.status === "RESERVED")).toHaveLength(1);
    expect(reqs.filter((r) => r.status === "UNAVAILABLE")).toHaveLength(1);
    const b = await bal(f.pad.id, f.locA.id);
    expect(b.quantityReserved).toBe(3);
    expect(b.quantityOnHand).toBe(4);
  });

  it("never issues the same request twice, even concurrently", async () => {
    const r = await prisma.sparePartRequest.findFirstOrThrow({ where: { itemId: f.pad.id, status: "RESERVED" } });
    const [a, b] = await Promise.allSettled([
      issuePart(f.actors.stockA, r.id, { receivedByMechanicId: f.users.mechA.id }),
      issuePart(f.actors.stockA, r.id, { receivedByMechanicId: f.users.mechA.id }),
    ]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    expect(await prisma.sparePartIssue.count({ where: { requestId: r.id } })).toBe(1);
    const after = await bal(f.pad.id, f.locA.id);
    expect(after.quantityOnHand).toBe(1);
    expect(after.quantityReserved).toBe(0);
    await expectCode(issuePart(f.actors.stockA, r.id, { receivedByMechanicId: f.users.mechA.id }), "BUSINESS_RULE");
  });

  it("rejects stock changes that would go negative (service rule and DB constraint)", async () => {
    const attempts = await Promise.allSettled(
      [1, 2, 3].map(() => prisma.$transaction((tx) => applyStockChange(tx, { itemId: f.pad.id, locationId: f.locA.id, branchId: f.A.id, type: "ADJUSTMENT_OUT", onHand: -1, performedById: f.users.stockA.id, reason: "test" }))),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    expect((await bal(f.pad.id, f.locA.id)).quantityOnHand).toBe(0);
    await expect(prisma.$executeRaw`UPDATE "InventoryBalance" SET "quantityOnHand" = -1 WHERE "itemId" = ${f.pad.id}::uuid AND "locationId" = ${f.locA.id}::uuid`).rejects.toThrow(/check constraint/);
  });

  it("records a stock movement for every change, and the ledger is append-only", async () => {
    const n = await prisma.stockMovement.count({ where: { itemId: f.pad.id, locationId: f.locA.id } });
    expect(n).toBeGreaterThanOrEqual(3);
    await expect(prisma.stockMovement.deleteMany({ where: { itemId: f.pad.id } })).rejects.toThrow();
  });
});

describe("13. Stock transfers update source and destination balances correctly", () => {
  it("moves stock B → A through dispatch and receipt", async () => {
    const before = { b: (await bal(f.pad.id, f.locB.id)).quantityOnHand, a: (await bal(f.pad.id, f.locA.id)).quantityOnHand };
    const t = await createTransfer(f.actors.admin, { fromLocationId: f.locB.id, toLocationId: f.locA.id, lines: [{ itemId: f.pad.id, quantity: 4 }] });
    // Branch A staff cannot dispatch from Branch B.
    await expectCode(progressTransfer(f.actors.stockA, t.id, "APPROVE"), "NOT_FOUND");
    await progressTransfer(f.actors.stockB, t.id, "APPROVE");
    await progressTransfer(f.actors.stockB, t.id, "DISPATCH");
    expect((await bal(f.pad.id, f.locB.id)).quantityOnHand).toBe(before.b - 4);
    expect((await bal(f.pad.id, f.locA.id)).quantityOnHand).toBe(before.a);
    await expectCode(progressTransfer(f.actors.stockB, t.id, "RECEIVE"), "NOT_FOUND");
    await progressTransfer(f.actors.stockA, t.id, "RECEIVE");
    expect((await bal(f.pad.id, f.locA.id)).quantityOnHand - (await bal(f.pad.id, f.locA.id)).quantityReserved + 0).toBeGreaterThanOrEqual(0);
    const a = await bal(f.pad.id, f.locA.id);
    expect(a.quantityOnHand).toBe(before.a + 4);
    // Arrived stock is allocated first to the job that was waiting on it.
    const waiting = await prisma.sparePartRequest.findFirstOrThrow({ where: { itemId: f.pad.id, jobId: { not: undefined }, status: { in: ["RESERVED", "UNAVAILABLE"] } } });
    expect(waiting.status).toBe("RESERVED");
    expect(a.quantityReserved).toBe(3);
    const mv = await prisma.stockMovement.findMany({ where: { referenceId: t.id } });
    expect(mv.map((m) => m.type).sort()).toEqual(["TRANSFER_IN", "TRANSFER_OUT"]);
  });
});
