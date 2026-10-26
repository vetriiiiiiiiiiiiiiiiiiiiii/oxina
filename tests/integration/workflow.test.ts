import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildFixture, expectCode, jobWithTasks, sendAndApprove, type Fixture } from "../fixtures";
import { addSupplementaryWork, decideEstimate, sendEstimate } from "@/lib/services/service/inspection";
import { issuePart, recordProcurement, verifyPartsAndRequest } from "@/lib/services/service/parts";
import { assignTaskMechanic, transitionTask } from "@/lib/services/service/repairs";
import { completeQualityInspection, DEFAULT_QC_CHECKLIST, endTestRide, startQualityInspection, startTestRide } from "@/lib/services/service/quality";
import { buildServiceInvoice, confirmPayment, finalizeInvoice, recordPayment } from "@/lib/services/billing";
import { handoverVehicle, markReadyForDelivery } from "@/lib/services/service/delivery";
import { receiveGoods } from "@/lib/services/inventory";

let f: Fixture;
beforeAll(async () => {
  f = await buildFixture();
  await prisma.supplier.create({ data: { businessUnitId: f.unit.id, code: "SUP", name: "Supplier" } });
});

const taskOf = (jobId: string, title: string) => prisma.repairTask.findFirstOrThrow({ where: { jobId, title } });
const handover = { recipientName: "Owner", recipientRelation: "OWNER" as const, odometerOut: 1005, customerAcknowledged: true, checklist: { vehicleInspectedWithCustomer: true, accessoriesReturned: true, invoiceExplained: true, oldPartsOffered: true } };

describe("8. Unavailable parts block dependent repair tasks", () => {
  it("blocks the task, informs the customer, then resumes when the part arrives", async () => {
    const job = await jobWithTasks(f, { tasks: [{ title: "Clutch", labour: 1500, parts: [{ itemId: f.clutch.id, quantity: 1 }] }, { title: "Wash", labour: 100 }] });
    await sendAndApprove(f, job.id);
    await verifyPartsAndRequest(f.actors.billA, job.id);
    const clutch = await taskOf(job.id, "Clutch");
    expect(clutch.status).toBe("BLOCKED");
    expect((await taskOf(job.id, "Wash")).status).toBe("READY"); // independent work continues
    expect((await prisma.serviceJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PARTS_PENDING");
    await assignTaskMechanic(f.actors.advA, clutch.id, { mechanicId: f.users.mechA.id });
    await expectCode(transitionTask(f.actors.mechA, clutch.id, { action: "START" }), "BUSINESS_RULE");
    const ev = await prisma.serviceTimelineEvent.findFirst({ where: { jobId: job.id, stage: "PARTS_BEING_ARRANGED" } });
    expect(ev?.customerNote).toMatch(/currently unavailable/);
    // No date recorded → no completion time promised.
    expect((await prisma.serviceJob.findUniqueOrThrow({ where: { id: job.id } })).etaLatest).toBeNull();
    const req = await prisma.sparePartRequest.findFirstOrThrow({ where: { jobId: job.id, itemId: f.clutch.id } });
    await recordProcurement(f.actors.stockA, req.id, { expectedAvailableAt: new Date(Date.now() + 48 * 3600_000) });
    const withDate = await prisma.serviceJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(withDate.etaLatest!.getTime()).toBeGreaterThan(Date.now() + 47 * 3600_000);
    // Goods arrive → reserved → issued → task becomes READY and can start.
    await receiveGoods(f.actors.stockA, { branchId: f.A.id, supplierId: (await prisma.supplier.findFirstOrThrow()).id, locationId: f.locA.id, lines: [{ itemId: f.clutch.id, quantity: 1, unitCost: 1500 }] });
    expect((await prisma.sparePartRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("RESERVED");
    await issuePart(f.actors.stockA, req.id, { receivedByMechanicId: f.users.mechA.id });
    expect((await taskOf(job.id, "Clutch")).status).toBe("READY");
    await transitionTask(f.actors.mechA, clutch.id, { action: "START" });
    const ready = await prisma.serviceJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(ready.status).toBe("IN_REPAIR");
    expect(ready.etaLatest!.getTime()).toBeLessThan(withDate.etaLatest!.getTime());
  });
});

describe("9. Additional chargeable work requires customer approval", () => {
  it("supplementary work cannot start until approved", async () => {
    const job = await jobWithTasks(f, { tasks: [{ title: "Service", labour: 500 }] });
    await sendAndApprove(f, job.id);
    const svc = await taskOf(job.id, "Service");
    await assignTaskMechanic(f.actors.advA, svc.id, { mechanicId: f.users.mechA.id });
    await transitionTask(f.actors.mechA, svc.id, { action: "START" });
    const { estimateId } = await addSupplementaryWork(f.actors.mechA, job.id, { reason: "Found worn chain", tasks: [{ title: "Chain replace", labourCharge: 600, minMinutes: 30, maxMinutes: 60, isOptional: false, isSafetyCritical: false, dependsOn: [], parts: [] }] });
    const chain = await taskOf(job.id, "Chain replace");
    expect(chain.requiresApproval && !chain.approved).toBe(true);
    await assignTaskMechanic(f.actors.advA, chain.id, { mechanicId: f.users.mechA.id });
    await expectCode(transitionTask(f.actors.mechA, chain.id, { action: "START" }), "BUSINESS_RULE");
    await sendEstimate(f.actors.advA, estimateId!);
    const est = await prisma.repairEstimate.findUniqueOrThrow({ where: { id: estimateId! }, include: { lines: true } });
    // A mechanic cannot approve on the customer's behalf.
    await expectCode(decideEstimate(f.actors.mechA, est.id, { channel: "IN_PERSON", decisions: est.lines.map((l) => ({ lineId: l.id, decision: "APPROVED" as const })) }), "FORBIDDEN");
    await decideEstimate(f.actors.cust1, est.id, { channel: "PORTAL", decisions: est.lines.map((l) => ({ lineId: l.id, decision: "APPROVED" as const })) });
    expect((await taskOf(job.id, "Chain replace")).status).toBe("READY");
    await transitionTask(f.actors.mechA, chain.id, { action: "START" });
    expect((await taskOf(job.id, "Chain replace")).status).toBe("IN_PROGRESS");
  });

  it("rejected work is cancelled and never started", async () => {
    const job = await jobWithTasks(f, { tasks: [{ title: "Optional polish", labour: 300 }] });
    const est = await prisma.repairEstimate.findFirstOrThrow({ where: { jobId: job.id }, include: { lines: true } });
    await sendEstimate(f.actors.advA, est.id);
    await decideEstimate(f.actors.cust1, est.id, { channel: "PORTAL", decisions: est.lines.map((l) => ({ lineId: l.id, decision: "REJECTED" as const })) });
    expect((await taskOf(job.id, "Optional polish")).status).toBe("CANCELLED");
    expect((await prisma.serviceJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("FINAL_BILLING");
  });
});

describe("7 & 10. Delivery gate and finalized-invoice immutability", () => {
  it("blocks delivery before QC passes, then completes the full workflow", async () => {
    const job = await jobWithTasks(f, { tasks: [{ title: "Tune-up", labour: 800 }] });
    await sendAndApprove(f, job.id);
    const t = await taskOf(job.id, "Tune-up");
    await assignTaskMechanic(f.actors.advA, t.id, { mechanicId: f.users.mechA.id });
    await transitionTask(f.actors.mechA, t.id, { action: "START" });
    await expectCode(transitionTask(f.actors.mechA, t.id, { action: "PAUSE" }), "VALIDATION"); // reason required
    await transitionTask(f.actors.mechA, t.id, { action: "PAUSE", reason: "Lunch" });
    await transitionTask(f.actors.mechA, t.id, { action: "RESUME" });
    await transitionTask(f.actors.mechA, t.id, { action: "COMPLETE" });
    expect((await prisma.serviceJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("QUALITY_CHECK");

    // Test 7: cannot invoice, mark ready or hand over before QC passes.
    await expectCode(markReadyForDelivery(f.actors.advA, job.id), "BUSINESS_RULE");
    await expectCode(handoverVehicle(f.actors.advA, job.id, handover), "BUSINESS_RULE");
    await expectCode(buildServiceInvoice(f.actors.billA, job.id), "BUSINESS_RULE");

    const qc = await startQualityInspection(f.actors.qcA, job.id);
    const pass = DEFAULT_QC_CHECKLIST.map((c) => ({ key: c.key, result: "PASS" as const }));
    // Missing test ride and a failed safety check both prevent passing.
    await expectCode(completeQualityInspection(f.actors.qcA, qc.id, { checklist: pass, testRideRequired: true, result: "PASSED", returnTaskIds: [] }), "BUSINESS_RULE");
    await expectCode(completeQualityInspection(f.actors.qcA, qc.id, { checklist: pass.map((c) => (c.key === "front_brake" ? { ...c, result: "FAIL" as const } : c)), testRideRequired: false, result: "PASSED", returnTaskIds: [] }), "BUSINESS_RULE");
    // Fail → back to repair.
    await completeQualityInspection(f.actors.qcA, qc.id, { checklist: pass, testRideRequired: false, result: "FAILED", failureReason: "Idle too high", returnTaskIds: [t.id] });
    expect((await taskOf(job.id, "Tune-up")).status).toBe("READY");
    await expectCode(markReadyForDelivery(f.actors.advA, job.id), "BUSINESS_RULE");
    await transitionTask(f.actors.mechA, t.id, { action: "START" });
    await transitionTask(f.actors.mechA, t.id, { action: "COMPLETE" });
    const qc2 = await startQualityInspection(f.actors.qcA, job.id);
    await startTestRide(f.actors.qcA, qc2.id, { odometerStart: 1000 });
    const ride = await prisma.testRide.findFirstOrThrow({ where: { qualityInspectionId: qc2.id } });
    await endTestRide(f.actors.qcA, ride.id, { odometerEnd: 1005, result: "OK" });
    await completeQualityInspection(f.actors.qcA, qc2.id, { checklist: pass, testRideRequired: true, result: "PASSED", returnTaskIds: [] });

    const inv = await buildServiceInvoice(f.actors.billA, job.id);
    await expectCode(markReadyForDelivery(f.actors.advA, job.id), "BUSINESS_RULE"); // invoice must be finalized
    await finalizeInvoice(f.actors.billA, inv.id);
    const fin = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(fin.invoiceNumber).toMatch(/^INV-RE-\d{4}-\d{6}$/);
    expect(Number(fin.grandTotal)).toBeCloseTo(944, 2); // 800 + 18% GST

    // Test 10: finalized invoices cannot be silently modified — service and database both refuse.
    await expectCode(buildServiceInvoice(f.actors.billA, job.id), "BUSINESS_RULE");
    await expectCode(finalizeInvoice(f.actors.billA, inv.id), "BUSINESS_RULE");
    await expect(prisma.invoice.update({ where: { id: inv.id }, data: { grandTotal: 1 } })).rejects.toThrow(/immutable/);
    await expect(prisma.invoiceLineItem.updateMany({ where: { invoiceId: inv.id }, data: { unitPrice: 1 } })).rejects.toThrow(/finalized/);
    await expect(prisma.invoice.delete({ where: { id: inv.id } })).rejects.toThrow();

    await markReadyForDelivery(f.actors.advA, job.id);
    // Unpaid balance blocks handover; pending (unconfirmed) payment does not count.
    await expectCode(handoverVehicle(f.actors.advA, job.id, handover), "BUSINESS_RULE");
    const p = await recordPayment(f.actors.billA, { invoiceId: inv.id, amount: 944, method: "UPI", reference: "UPI123", confirmNow: false });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("FINALIZED");
    await expectCode(handoverVehicle(f.actors.advA, job.id, handover), "BUSINESS_RULE");
    await confirmPayment(f.actors.billA, p.id);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    await handoverVehicle(f.actors.advA, job.id, handover);
    const closed = await prisma.serviceJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(closed.status).toBe("CLOSED");
    expect(await prisma.followUp.count({ where: { serviceJobId: job.id } })).toBe(4);
    const stages = (await prisma.serviceTimelineEvent.findMany({ where: { jobId: job.id } })).map((e) => e.stage);
    for (const s of ["VEHICLE_RECEIVED", "INSPECTION_COMPLETED", "ESTIMATE_AWAITING_APPROVAL", "APPROVAL_RECEIVED", "REPAIR_IN_PROGRESS", "QUALITY_INSPECTION", "TEST_RIDE", "FINAL_BILLING", "READY_FOR_DELIVERY", "DELIVERED"]) expect(stages).toContain(s);
  });

  it("rejects card numbers in payment references", async () => {
    const { paymentInput } = await import("@/lib/services/billing");
    expect(paymentInput.safeParse({ invoiceId: "00000000-0000-0000-0000-000000000000", amount: 1, method: "CARD", reference: "4111 1111 1111 1111" }).success).toBe(false);
  });
});
