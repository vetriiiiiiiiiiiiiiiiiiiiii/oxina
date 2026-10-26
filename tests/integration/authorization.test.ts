import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildFixture, expectCode, jobWithTasks, sendAndApprove, type Fixture } from "../fixtures";
import { getJobForActor } from "@/lib/services/service/common";
import { listJobs } from "@/lib/services/service/intake";
import { getCustomerForActor } from "@/lib/services/customers";
import { buildServiceInvoice, finalizeInvoice, getInvoiceForActor } from "@/lib/services/billing";
import { runReport, toCsv, dashboard } from "@/lib/services/reports";
import { branchFilter } from "@/lib/rbac/actor";
import { listStock } from "@/lib/services/inventory";

let f: Fixture;
let jobA: { id: string };
let jobB: { id: string };

beforeAll(async () => {
  f = await buildFixture();
  jobA = await jobWithTasks(f, { tasks: [{ title: "Service", labour: 500 }] });
  const advB = await prisma.user.create({ data: { email: "adv.b@t.test", name: "adv b", passwordHash: "x", roles: { create: { role: { connect: { key: "SERVICE_ADVISOR" } } } }, branchAssignments: { create: { branchId: f.B.id } } } });
  const { loadActor } = await import("@/lib/rbac/actor");
  jobB = await jobWithTasks(f, { branch: "B", customerId: f.c3.id, advisor: (await loadActor(advB.id))!, tasks: [{ title: "Service B", labour: 500 }] });
});

describe("1. Super Admin can access authorized branches", () => {
  it("sees jobs in every branch and the group dashboard", async () => {
    const all = await listJobs(f.actors.admin, { view: "all", page: 1, pageSize: 50 });
    expect(all.rows.map((r) => r.id).sort()).toEqual([jobA.id, jobB.id].sort());
    await expect(getJobForActor(f.actors.admin, jobB.id)).resolves.toBeTruthy();
    const d = await dashboard(f.actors.admin, { preset: "30d" });
    expect(d.branches.map((b) => b.id).sort()).toEqual([f.A.id, f.B.id].sort());
  });
});

describe("2. A Branch A manager cannot access Branch B records", () => {
  it("is denied by id, by filter parameter and in listings", async () => {
    await expectCode(getJobForActor(f.actors.mgrA, jobB.id), "NOT_FOUND");
    await expectCode(getCustomerForActor(f.actors.mgrA, f.c3.id), "NOT_FOUND");
    expect(() => branchFilter(f.actors.mgrA, f.B.id)).toThrow();
    await expectCode(listJobs(f.actors.mgrA, { branchId: f.B.id, view: "all", page: 1, pageSize: 50 }), "NOT_FOUND");
    const mine = await listJobs(f.actors.mgrA, { view: "all", page: 1, pageSize: 50 });
    expect(mine.rows.every((r) => r.id !== jobB.id)).toBe(true);
    const stock = await listStock(f.actors.mgrA, { page: 1 });
    expect(stock.rows.every((r) => r.branch.code === "RE-A")).toBe(true);
  });
});

describe("4. A mechanic cannot modify invoices without permission", () => {
  it("cannot prepare, finalize or read invoices", async () => {
    const j = await jobWithTasks(f, { tasks: [{ title: "Quick fix", labour: 0 }] }); // no chargeable work → FINAL_BILLING path
    await prisma.serviceJob.update({ where: { id: j.id }, data: { status: "FINAL_BILLING" } });
    await expectCode(buildServiceInvoice(f.actors.mechA, j.id), "FORBIDDEN");
    const inv = await prisma.invoice.create({ data: { branchId: f.A.id, kind: "SERVICE", customerId: f.c1.id, createdById: f.users.billA.id } });
    await expectCode(finalizeInvoice(f.actors.mechA, inv.id), "FORBIDDEN");
    await expectCode(getInvoiceForActor(f.actors.mechA, inv.id), "FORBIDDEN");
  });
});

describe("15. Branch filters and exports respect authorization", () => {
  it("reports for another branch are rejected and exports contain only authorised rows", async () => {
    await expectCode(runReport(f.actors.mgrA, "service_jobs", { preset: "30d", branchId: f.B.id }), "NOT_FOUND");
    const r = await runReport(f.actors.mgrA, "service_jobs", { preset: "30d" });
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((row) => row.branch === "Branch RE-A")).toBe(true);
    const csv = toCsv(r.columns, r.rows);
    expect(csv).not.toContain("Branch RE-B");
    const admin = await runReport(f.actors.admin, "service_jobs", { preset: "30d" });
    expect(admin.rows.some((row) => row.branch === "Branch RE-B")).toBe(true);
  });

  it("neutralises spreadsheet formula injection in CSV", () => {
    expect(toCsv(["a"], [{ a: "=HYPERLINK(1)" }])).toContain("'=HYPERLINK");
  });

  it("mechanics only see jobs they are assigned to", async () => {
    const before = await listJobs(f.actors.mechA, { view: "all", page: 1, pageSize: 50 });
    expect(before.rows.length).toBe(0);
    await expectCode(getJobForActor(f.actors.mechA, jobA.id), "NOT_FOUND");
    await sendAndApprove(f, jobA.id);
    const t = await prisma.repairTask.findFirstOrThrow({ where: { jobId: jobA.id } });
    const { assignTaskMechanic } = await import("@/lib/services/service/repairs");
    await assignTaskMechanic(f.actors.advA, t.id, { mechanicId: f.users.mechA.id });
    await expect(getJobForActor(f.actors.mechA, jobA.id)).resolves.toBeTruthy();
  });
});
