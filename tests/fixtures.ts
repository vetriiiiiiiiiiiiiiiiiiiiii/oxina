/**
 * Test fixture: two Royal Enfield branches (A, B), staff for each, two portal customers,
 * parts with known stock. Built fresh for each test file on the isolated test database.
 */
import { prisma } from "@/lib/db";
import { syncRbac } from "@/lib/rbac/sync";
import { loadActor, type Actor } from "@/lib/rbac/actor";
import { hashPassword } from "@/lib/auth/password";
import { createServiceJob } from "@/lib/services/service/intake";
import { completeInspection, decideEstimate, sendEstimate } from "@/lib/services/service/inspection";

export async function resetDb() {
  if (!/test/i.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Refusing to wipe a non-test database");
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // TRUNCATE bypasses the row-level append-only triggers, which is what we want for a clean test DB.
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

let hash: string | null = null;
async function user(email: string, roleKey: string, branchIds: string[], type: "STAFF" | "CUSTOMER" = "STAFF") {
  hash ??= await hashPassword("Fixture@Pass2026!");
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  return prisma.user.create({
    data: { email, name: email.split("@")[0], userType: type, passwordHash: hash, roles: { create: { roleId: role.id } }, branchAssignments: { create: branchIds.map((branchId) => ({ branchId })) } },
  });
}

export async function buildFixture() {
  await resetDb();
  await syncRbac(prisma);
  const group = await prisma.businessGroup.create({ data: { name: "Oxina Groups", code: "OXINA" } });
  const unit = await prisma.businessUnit.create({ data: { groupId: group.id, name: "Royal Enfield", code: "RE", type: "AUTOMOTIVE_DEALERSHIP" } });
  // Seven-day working week, 00:00–23:59 so ETA assertions don't depend on when tests run.
  const mk = (code: string) => prisma.branch.create({ data: { businessUnitId: unit.id, name: `Branch ${code}`, code, stateCode: "33", workingDays: [1, 2, 3, 4, 5, 6, 7], workdayStart: "00:00", workdayEnd: "23:59" } });
  const A = await mk("RE-A");
  const B = await mk("RE-B");
  const locA = await prisma.inventoryLocation.create({ data: { branchId: A.id, code: "SVC", name: "Store A", type: "SERVICE_STORE" } });
  const locB = await prisma.inventoryLocation.create({ data: { branchId: B.id, code: "SVC", name: "Store B", type: "SERVICE_STORE" } });
  const model = await prisma.vehicleModel.create({ data: { businessUnitId: unit.id, brand: "RE", name: "Classic 350", variant: "" } });
  const pad = await prisma.inventoryItem.create({ data: { businessUnitId: unit.id, partNumber: "PAD", name: "Brake pad", category: "SPARE_PART", purchaseCost: 400, sellingPrice: 700 } });
  const clutch = await prisma.inventoryItem.create({ data: { businessUnitId: unit.id, partNumber: "CLUTCH", name: "Clutch plate", category: "SPARE_PART", purchaseCost: 1500, sellingPrice: 2400 } });
  await prisma.inventoryBalance.create({ data: { itemId: pad.id, locationId: locA.id, branchId: A.id, quantityOnHand: 4 } });
  await prisma.inventoryBalance.create({ data: { itemId: clutch.id, locationId: locA.id, branchId: A.id, quantityOnHand: 0 } });
  await prisma.inventoryBalance.create({ data: { itemId: pad.id, locationId: locB.id, branchId: B.id, quantityOnHand: 10 } });

  const admin = await user("admin@t.test", "SUPER_ADMIN", []);
  const mgrA = await user("mgr.a@t.test", "BRANCH_MANAGER", [A.id]);
  const mgrB = await user("mgr.b@t.test", "BRANCH_MANAGER", [B.id]);
  const advA = await user("adv.a@t.test", "SERVICE_ADVISOR", [A.id]);
  const billA = await user("bill.a@t.test", "BILLING_EXECUTIVE", [A.id]);
  const stockA = await user("stock.a@t.test", "WAREHOUSE_EXECUTIVE", [A.id]);
  const mechA = await user("mech.a@t.test", "MECHANIC", [A.id]);
  const qcA = await user("qc.a@t.test", "QUALITY_INSPECTOR", [A.id]);
  const stockB = await user("stock.b@t.test", "WAREHOUSE_EXECUTIVE", [B.id]);
  const cu1 = await user("c1@t.test", "CUSTOMER", [], "CUSTOMER");
  const cu2 = await user("c2@t.test", "CUSTOMER", [], "CUSTOMER");
  const c1 = await prisma.customer.create({ data: { customerCode: "C1", fullName: "Customer One", phone: "+919000000001", email: "c1@t.test", userId: cu1.id, createdAtBranchId: A.id } });
  const c2 = await prisma.customer.create({ data: { customerCode: "C2", fullName: "Customer Two", phone: "+919000000002", email: "c2@t.test", userId: cu2.id, createdAtBranchId: A.id } });
  const c3 = await prisma.customer.create({ data: { customerCode: "C3", fullName: "Customer Three", phone: "+919000000003", createdAtBranchId: B.id } });

  const as = async (u: { id: string }) => (await loadActor(u.id))!;
  return {
    unit, A, B, locA, locB, model, pad, clutch, c1, c2, c3,
    users: { admin, mgrA, mgrB, advA, billA, stockA, mechA, qcA, stockB, cu1, cu2 },
    actors: {
      admin: await as(admin), mgrA: await as(mgrA), mgrB: await as(mgrB), advA: await as(advA), billA: await as(billA), stockA: await as(stockA),
      mechA: await as(mechA), qcA: await as(qcA), stockB: await as(stockB), cust1: await as(cu1), cust2: await as(cu2),
    },
  };
}

export type Fixture = Awaited<ReturnType<typeof buildFixture>>;

let reg = 1000;
/** Create a job and complete inspection with the given tasks (parts optional). */
export async function jobWithTasks(f: Fixture, opts: { branch?: "A" | "B"; customerId?: string; advisor?: Actor; tasks: { title: string; labour: number; parts?: { itemId: string; quantity: number }[]; dependsOn?: number[]; min?: number; max?: number }[] }) {
  const advisor = opts.advisor ?? f.actors.advA;
  const job = await createServiceJob(advisor, {
    branchId: (opts.branch ?? "A") === "A" ? f.A.id : f.B.id,
    customerId: opts.customerId ?? f.c1.id,
    vehicle: { registrationNumber: `TN01AB${reg++}`, modelName: "Classic 350", vehicleModelId: f.model.id },
    serviceType: "GENERAL_REPAIR", isEmergency: false, odometerIn: 1000, fuelLevel: "HALF", reportedProblems: "Test problem", accessoriesReceived: [],
  });
  await completeInspection(advisor, job.id, {
    checklist: [], safetyCritical: false, customerSummary: "Summary for customer", internalNotes: "SECRET-INTERNAL-NOTE supplier cost 400",
    tasks: opts.tasks.map((t) => ({ title: t.title, labourCharge: t.labour, minMinutes: t.min ?? 30, maxMinutes: t.max ?? 60, isOptional: false, isSafetyCritical: false, dependsOn: t.dependsOn ?? [], parts: t.parts ?? [] })),
  });
  return job;
}

export async function sendAndApprove(f: Fixture, jobId: string, approver?: Actor) {
  const est = await prisma.repairEstimate.findFirstOrThrow({ where: { jobId, status: "DRAFT" }, include: { lines: true } });
  await sendEstimate(f.actors.advA, est.id);
  const a = approver ?? f.actors.cust1;
  await decideEstimate(a, est.id, { channel: a.kind === "CUSTOMER" ? "PORTAL" : "IN_PERSON", decisions: est.lines.filter((l) => l.approvalStatus === "PENDING").map((l) => ({ lineId: l.id, decision: "APPROVED" as const })) });
  return est;
}

export async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    const c = (e as { code?: string }).code;
    if (c !== code) throw new Error(`Expected ${code}, got ${c}: ${(e as Error).message}`);
    return e as Error;
  }
  throw new Error(`Expected ${code} but the call succeeded`);
}
