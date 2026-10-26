import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildFixture, expectCode, type Fixture } from "../fixtures";
import { addVehicle, createBooking, createLead, deliverBooking, updateBooking } from "@/lib/services/showroom";
import { confirmPayment, recordPayment } from "@/lib/services/billing";
import { loadActor } from "@/lib/rbac/actor";

let f: Fixture;
beforeAll(async () => {
  f = await buildFixture();
});

describe("Showroom booking → delivery", () => {
  it("enforces pricing rights, payment before confirmation/delivery, and invoices exactly what was agreed", async () => {
    const salesUser = await prisma.user.create({ data: { email: "sales.a@t.test", name: "sales", passwordHash: "x", roles: { create: { role: { connect: { key: "SALES_EXECUTIVE" } } } }, branchAssignments: { create: { branchId: f.A.id } } } });
    const sales = (await loadActor(salesUser.id))!;
    const v = await addVehicle(f.actors.mgrA, { branchId: f.A.id, vehicleModelId: f.model.id, modelYear: 2026, colour: "Black", vin: "ME3TESTVIN0000001", engineNumber: "ENG00001", purchaseCost: 160000, exShowroomPrice: 200000, insuranceCharges: 9000, registrationCharges: 20000, accessoriesCharges: 0, fittingCharges: 0, otherCharges: 0 });
    const lead = await createLead(sales, { branchId: f.A.id, name: "Buyer", phone: "+919111111111", source: "WALK_IN" });

    // Sales executives cannot give manual discounts.
    await expectCode(createBooking(sales, { branchId: f.A.id, leadId: lead.id, vehicleId: v.id, vehicleModelId: f.model.id, discountAmount: 5000, financeStatus: "NOT_REQUIRED", accessories: [] }), "FORBIDDEN");
    const b = await createBooking(f.actors.mgrA, { branchId: f.A.id, leadId: lead.id, vehicleId: v.id, vehicleModelId: f.model.id, discountAmount: 5000, financeStatus: "NOT_REQUIRED", accessories: [] });
    expect(Number(b.totalAmount)).toBe(229000 - 5000);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("RESERVED");
    // The same vehicle cannot be booked twice.
    await expectCode(createBooking(f.actors.mgrA, { branchId: f.A.id, vehicleId: v.id, customerId: b.customerId, vehicleModelId: f.model.id, discountAmount: 0, financeStatus: "NOT_REQUIRED", accessories: [] }), "CONFLICT");

    await expectCode(updateBooking(f.actors.mgrA, b.id, { status: "CONFIRMED" }), "BUSINESS_RULE");
    const p1 = await recordPayment(f.actors.mgrA, { bookingId: b.id, amount: 10000, method: "UPI", reference: "U1", confirmNow: false });
    await confirmPayment(f.actors.mgrA, p1.id);
    await updateBooking(f.actors.mgrA, b.id, { status: "CONFIRMED" });
    await updateBooking(f.actors.mgrA, b.id, { status: "READY_FOR_DELIVERY", registrationNumber: "TN01ZZ9999", registrationStatus: "COMPLETED" });
    const checklist = { documentsHandedOver: true, accessoriesFitted: true, vehicleWalkaround: true, ownersManual: true, insuranceCopy: true };
    await expectCode(deliverBooking(f.actors.mgrA, b.id, { checklist, customerAcknowledged: true }), "BUSINESS_RULE"); // unpaid balance
    await expectCode(deliverBooking(sales, b.id, { checklist, customerAcknowledged: true }), "FORBIDDEN"); // finalizing a sale needs pricing rights
    await recordPayment(f.actors.mgrA, { bookingId: b.id, amount: 214000, method: "BANK_TRANSFER", reference: "N1", confirmNow: true });
    const d = await deliverBooking(f.actors.mgrA, b.id, { checklist, customerAcknowledged: true });

    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: d.invoiceId }, include: { lines: true } });
    expect(Number(inv.grandTotal)).toBe(224000); // equals the booking total — GST-inclusive discount handled correctly
    expect(inv.status).toBe("PAID");
    expect(Number(inv.balanceDue)).toBe(0);
    expect(Number(inv.subtotal) - Number(inv.discountTotal) + Number(inv.taxTotal)).toBeCloseTo(224000, 2);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("DELIVERED");
    const cv = await prisma.customerVehicle.findUniqueOrThrow({ where: { soldVehicleId: v.id } });
    expect(cv.registrationNumber).toBe("TN01ZZ9999");
    expect(await prisma.warranty.count({ where: { vehicleId: v.id, type: "VEHICLE" } })).toBe(1);
  });
});
