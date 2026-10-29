import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { loadActor, type Actor } from "@/lib/rbac/actor";
import { buildFixture, expectCode, type Fixture } from "../fixtures";
import { buildNav } from "@/components/shell/nav";
import { listJobs, createServiceJob } from "@/lib/services/service/intake";
import { createBooking, listLeads } from "@/lib/services/showroom";
import { createPurchaseOrder } from "@/lib/services/inventory";
import { allowedReports, dashboard, runReport } from "@/lib/services/reports";
import { getInvoiceForActor, listInvoices } from "@/lib/services/billing";

let f: Fixture;
const A: Record<string, Actor> = {};

async function mk(email: string, role: string, branchId: string) {
  const u = await prisma.user.create({ data: { email, name: role, passwordHash: "x", roles: { create: { role: { connect: { key: role } } } }, branchAssignments: { create: { branchId } } } });
  return (await loadActor(u.id))!;
}

beforeAll(async () => {
  f = await buildFixture();
  A.service = await mk("svc.mgr@t.test", "SERVICE_MANAGER", f.A.id);
  A.showroom = await mk("sr.mgr@t.test", "SHOWROOM_MANAGER", f.A.id);
  A.stores = await mk("st.mgr@t.test", "STORES_MANAGER", f.A.id);
  A.mechanic = f.actors.mechA;
});

const labels = (a: Actor) => buildNav(a, [{ id: f.A.id, name: "Branch A" }]).flatMap((g) => g.items.map((i) => i.label));

describe("Each person sees only their own area", () => {
  it("menus contain only the person's department", () => {
    const svc = labels(A.service);
    expect(svc).toEqual(expect.arrayContaining(["Service jobs", "Workshop board", "Follow-up calls", "My branch"]));
    expect(svc).not.toEqual(expect.arrayContaining(["Leads & bookings"]));
    for (const x of ["Leads & bookings", "Vehicles in stock", "Stock", "Purchases", "Branches", "Audit log"]) expect(svc).not.toContain(x);

    const sr = labels(A.showroom);
    expect(sr).toEqual(expect.arrayContaining(["Leads & bookings", "Vehicles in stock", "Offers"]));
    for (const x of ["Service jobs", "Workshop board", "Stock", "Purchases", "Settings"]) expect(sr).not.toContain(x);

    const st = labels(A.stores);
    expect(st).toEqual(expect.arrayContaining(["Stock", "Workshop requests", "Purchases"]));
    for (const x of ["Service jobs", "Leads & bookings", "Customers", "Billing"]) expect(st).not.toContain(x);

    const mech = labels(A.mechanic);
    expect(mech).toEqual(expect.arrayContaining(["My work", "Service jobs", "Workshop board"]));
    for (const x of ["Customers", "Billing", "Reports", "Settings", "Stock", "Staff"]) expect(mech).not.toContain(x);

    // Branch Manager runs every area of their branch; a single-branch manager gets "My branch", not the group list.
    const bm = labels(f.actors.mgrA);
    expect(bm).toEqual(expect.arrayContaining(["Service jobs", "Leads & bookings", "Stock", "Billing", "My branch"]));
    expect(bm).not.toContain("Branches");
  });

  it("the server refuses work outside the department", async () => {
    await expectCode(createBooking(A.service, { branchId: f.A.id, vehicleModelId: f.model.id, customerId: f.c1.id, discountAmount: 0, financeStatus: "NOT_REQUIRED", accessories: [] }), "FORBIDDEN");
    await expectCode(createPurchaseOrder(A.service, { branchId: f.A.id, supplierId: f.A.id, lines: [{ itemId: f.pad.id, quantity: 1, unitCost: 1 }] }), "FORBIDDEN");
    await expectCode(listJobs(A.showroom, { view: "open", page: 1, pageSize: 10 }), "FORBIDDEN");
    await expectCode(createServiceJob(A.stores, { branchId: f.A.id, customerId: f.c1.id, vehicle: { registrationNumber: "TN01ZZ0001", modelName: "x" }, serviceType: "GENERAL_REPAIR", isEmergency: false, odometerIn: 1, fuelLevel: "HALF", reportedProblems: "test", accessoriesReceived: [] }), "FORBIDDEN");
    await expectCode(listLeads(A.stores, {}), "FORBIDDEN");
    await expect(listJobs(A.service, { view: "open", page: 1, pageSize: 10 })).resolves.toBeTruthy();
  });

  it("dashboard figures outside the person's area are not sent to them", async () => {
    const svc = await dashboard(A.service, { preset: "30d" });
    expect(svc.kpis.salesRevenue).toBeNull();
    expect(svc.kpis.lowStock).toBeNull();
    expect(svc.kpis.jobsInProgress).not.toBeNull();
    expect(svc.series.every((d) => d.sales === 0)).toBe(true);

    const sr = await dashboard(A.showroom, { preset: "30d" });
    expect(sr.kpis.jobsInProgress).toBeNull();
    expect(sr.kpis.serviceRevenue).toBeNull();
    expect(sr.kpis.salesRevenue).not.toBeNull();
    expect(sr.delayed).toEqual([]);

    const st = await dashboard(A.stores, { preset: "30d" });
    expect(st.kpis.salesRevenue).toBeNull();
    expect(st.kpis.serviceRevenue).toBeNull();
    expect(st.kpis.lowStock).not.toBeNull();
  });

  it("reports are limited to the person's area", async () => {
    expect(allowedReports(A.service)).not.toContain("vehicle_sales");
    expect(allowedReports(A.showroom)).toEqual(["vehicle_sales"]);
    expect(allowedReports(A.stores)).toEqual(expect.arrayContaining(["inventory_valuation", "stock_shortages"]));
    expect(allowedReports(A.stores)).not.toContain("revenue");
    await expectCode(runReport(A.service, "vehicle_sales", { preset: "30d" }), "FORBIDDEN");
    await expectCode(runReport(A.showroom, "service_jobs", { preset: "30d" }), "FORBIDDEN");
    await expect(runReport(A.service, "service_jobs", { preset: "30d" })).resolves.toBeTruthy();
  });

  it("department managers only see their own department's invoices", async () => {
    const svc = await prisma.invoice.create({ data: { branchId: f.A.id, kind: "SERVICE", customerId: f.c1.id, createdById: f.users.billA.id } });
    const sale = await prisma.invoice.create({ data: { branchId: f.A.id, kind: "VEHICLE_SALE", customerId: f.c1.id, createdById: f.users.billA.id } });
    await expectCode(getInvoiceForActor(A.showroom, svc.id), "NOT_FOUND");
    await expect(getInvoiceForActor(A.showroom, sale.id)).resolves.toBeTruthy();
    await expectCode(getInvoiceForActor(A.service, sale.id), "NOT_FOUND");
    const srList = await listInvoices(A.showroom, { page: 1 });
    expect(srList.rows.every((r) => r.kind === "VEHICLE_SALE")).toBe(true);
    const all = await listInvoices(f.actors.billA, { page: 1 });
    expect(all.rows.map((r) => r.kind).sort()).toEqual(["SERVICE", "VEHICLE_SALE"]);
  });
});
