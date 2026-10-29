import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildFixture, expectCode, jobWithTasks, type Fixture } from "../fixtures";
import { getJobForActor } from "@/lib/services/service/common";
import { customerJobView } from "@/lib/services/service/delivery";
import { decideEstimate, sendEstimate } from "@/lib/services/service/inspection";
import { authorizeFile, createFileLink } from "@/lib/services/files";
import { signFileToken, verifyFileToken } from "@/lib/crypto";

let f: Fixture;
let job1: { id: string };
let job2: { id: string };

beforeAll(async () => {
  f = await buildFixture();
  job1 = await jobWithTasks(f, { customerId: f.c1.id, tasks: [{ title: "Brake pads", labour: 400, parts: [{ itemId: f.pad.id, quantity: 1 }] }] });
  job2 = await jobWithTasks(f, { customerId: f.c2.id, tasks: [{ title: "Oil change", labour: 300 }] });
});

describe("3. A customer cannot access another customer's service job", () => {
  it("sees own job, not others", async () => {
    await expect(getJobForActor(f.actors.cust1, job1.id)).resolves.toBeTruthy();
    await expectCode(getJobForActor(f.actors.cust1, job2.id), "NOT_FOUND");
    await expectCode(customerJobView(f.actors.cust1, job2.id), "NOT_FOUND");
  });
});

describe("5. Customers cannot approve estimates belonging to other customers", () => {
  it("rejects the decision and leaves the estimate untouched", async () => {
    const est = await prisma.repairEstimate.findFirstOrThrow({ where: { jobId: job2.id }, include: { lines: true } });
    await sendEstimate(f.actors.advA, est.id);
    await expectCode(decideEstimate(f.actors.cust1, est.id, { channel: "PORTAL", decisions: est.lines.map((l) => ({ lineId: l.id, decision: "APPROVED" as const })) }), "NOT_FOUND");
    const after = await prisma.repairEstimate.findUniqueOrThrow({ where: { id: est.id } });
    expect(after.status).toBe("SENT");
    expect(await prisma.customerApproval.count({ where: { estimateId: est.id } })).toBe(0);
    // ...while the rightful customer can.
    await decideEstimate(f.actors.cust2, est.id, { channel: "PORTAL", decisions: est.lines.map((l) => ({ lineId: l.id, decision: "APPROVED" as const })) });
    expect((await prisma.repairEstimate.findUniqueOrThrow({ where: { id: est.id } })).status).toBe("APPROVED");
  });
});

describe("11. Unauthorized users cannot access private document URLs", () => {
  it("binds links to the file, the user and an expiry; checks access again on download", async () => {
    const file = await prisma.fileObject.create({ data: { branchId: f.A.id, storageKey: "x/1.jpg", originalName: "1.jpg", mimeType: "image/jpeg", sizeBytes: 3, sha256: "x", uploadedById: f.users.advA.id } });
    await prisma.servicePhoto.create({ data: { jobId: job1.id, fileId: file.id, stage: "INTAKE", customerVisible: false, uploadedById: f.users.advA.id } });
    // Internal photo: owner customer cannot get a link; other-branch staff cannot either.
    await expectCode(createFileLink(f.actors.cust1, file.id), "NOT_FOUND");
    await expectCode(createFileLink(f.actors.mgrB, file.id), "NOT_FOUND");
    await expect(authorizeFile(f.actors.advA, file.id)).resolves.toBeTruthy();
    // Tokens are user-bound and expire.
    const tok = signFileToken(file.id, f.users.advA.id, 60);
    expect(verifyFileToken(file.id, f.users.advA.id, tok)).toBe(true);
    expect(verifyFileToken(file.id, f.users.mgrB.id, tok)).toBe(false);
    expect(verifyFileToken(file.id, f.users.advA.id, signFileToken(file.id, f.users.advA.id, -1))).toBe(false);
    const mid = tok.length - 10;
    expect(verifyFileToken(file.id, f.users.advA.id, tok.slice(0, mid) + (tok[mid] === "A" ? "B" : "A") + tok.slice(mid + 1))).toBe(false);
    expect(verifyFileToken(file.id, f.users.advA.id, tok.slice(0, -1) + (tok.at(-1) === "A" ? "B" : "A"))).toBe(false);
    // Once shared with the customer, only that customer can open it.
    await prisma.servicePhoto.updateMany({ where: { fileId: file.id }, data: { customerVisible: true } });
    await expect(createFileLink(f.actors.cust1, file.id)).resolves.toHaveProperty("url");
    await expectCode(createFileLink(f.actors.cust2, file.id), "NOT_FOUND");
    // Sensitive files require the sensitive-data permission even within the branch.
    await prisma.fileObject.update({ where: { id: file.id }, data: { isSensitive: true } });
    await expectCode(authorizeFile(f.actors.mechA, file.id), "NOT_FOUND");
    await expectCode(createFileLink(f.actors.cust1, file.id), "NOT_FOUND");
  });
});

describe("12b. Customer view explains the work without leaking internals", () => {
  it("shows what is being done, parts, time and technician first name only", async () => {
    await prisma.user.update({ where: { id: f.users.mechA.id }, data: { name: "Manikandan Rajendran" } });
    const t = await prisma.repairTask.findFirstOrThrow({ where: { jobId: job1.id } });
    await prisma.repairTask.update({ where: { id: t.id }, data: { approved: true, status: "BLOCKED", holdReason: "Customer disputes price - manager to call back", description: "Pads are worn; braking is weaker.", assignedMechanicId: f.users.mechA.id } });
    await prisma.estimateLineItem.updateMany({ where: { repairTaskId: t.id }, data: { approvalStatus: "APPROVED" } });
    await prisma.repairEstimate.updateMany({ where: { jobId: job1.id }, data: { status: "APPROVED" } });
    const view = await customerJobView(f.actors.cust1, job1.id);
    const r = view.repairs.find((x) => x.id === t.id)!;
    expect(r.why).toBe("Pads are worn; braking is weaker.");
    expect(r.state.label).toMatch(/On hold/);
    expect(r.technician).toBe("Manikandan");
    expect(r.time.estimateMax).toBeGreaterThan(0);
    expect(r.parts.map((p) => p.name)).toContain("Brake pad");
    const json = JSON.stringify(view);
    expect(json).not.toContain("disputes price");
    expect(json).not.toContain("Rajendran");
    expect(json).not.toMatch(/holdReason|purchaseCost|internalNotes/);
  });
});

describe("12. Customer tracking does not expose internal notes", () => {
  it("omits internal notes, costs, supplier data and other customers", async () => {
    const view = await customerJobView(f.actors.cust1, job1.id);
    const json = JSON.stringify(view);
    expect(json).not.toContain("SECRET-INTERNAL-NOTE");
    expect(json).not.toMatch(/internalNotes|purchaseCost|supplier|passwordHash|Customer Two/);
    expect(json).toContain("Summary for customer");
    expect(view.events.length).toBeGreaterThan(0);
  });
});
