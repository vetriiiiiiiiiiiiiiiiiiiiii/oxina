/**
 * DEVELOPMENT / DEMO SEED — fictional data only.
 *
 * Refuses to run unless ALLOW_DEMO_SEED=true and NODE_ENV !== "production".
 * Service jobs are pushed through the real service layer (same code paths as the app),
 * so every status, timeline entry, stock movement and ETA is consistent.
 *
 * Demo sign-in password for every demo account: see DEMO_PASSWORD below (development only).
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { syncRbac } from "../src/lib/rbac/sync";
import { loadActor, type Actor } from "../src/lib/rbac/actor";
import { createServiceJob } from "../src/lib/services/service/intake";
import { completeInspection, decideEstimate, sendEstimate, startInspection } from "../src/lib/services/service/inspection";
import { issuePart, recordProcurement, verifyPartsAndRequest } from "../src/lib/services/service/parts";
import { assignTaskMechanic, transitionTask } from "../src/lib/services/service/repairs";
import { completeQualityInspection, endTestRide, startQualityInspection, startTestRide, DEFAULT_QC_CHECKLIST } from "../src/lib/services/service/quality";
import { buildServiceInvoice, confirmPayment, finalizeInvoice, recordPayment } from "../src/lib/services/billing";
import { handoverVehicle, markReadyForDelivery } from "../src/lib/services/service/delivery";
import { DEFAULT_TEMPLATES } from "../src/lib/notifications/templates";

export const DEMO_PASSWORD = "Demo@Oxina2026!";
const prisma = new PrismaClient();

const DURATIONS: [string, string, number, number, number][] = [
  ["VEHICLE_INTAKE", "Vehicle intake", 10, 15, 0],
  ["BASIC_INSPECTION", "Basic inspection", 20, 30, 0],
  ["DETAILED_DIAGNOSIS", "Detailed diagnosis", 30, 60, 350],
  ["ESTIMATE_PREPARATION", "Estimate preparation", 10, 15, 0],
  ["PART_PICKING", "Spare-part picking", 10, 20, 0],
  ["OIL_FILTER", "Oil and filter replacement", 30, 45, 300],
  ["PERIODIC_SERVICE", "General periodic service", 60, 120, 900],
  ["BRAKE_ADJUST", "Brake inspection and adjustment", 30, 60, 250],
  ["BRAKE_PADS", "Brake pad replacement", 45, 90, 400],
  ["CHAIN_ADJUST", "Chain cleaning and adjustment", 20, 40, 200],
  ["BATTERY", "Battery testing and replacement", 20, 40, 150],
  ["TYRE", "Tyre replacement", 30, 60, 250],
  ["ELEC_BASIC", "Basic electrical diagnosis", 30, 90, 400],
  ["ELEC_COMPLEX", "Complex electrical diagnosis", 60, 180, 900],
  ["CLUTCH", "Clutch repair", 120, 240, 1500],
  ["ENGINE", "Engine repair", 240, 1440, 4500],
  ["QUALITY_INSPECTION", "Quality inspection", 15, 30, 0],
  ["TEST_RIDE", "Test ride", 10, 20, 0],
  ["FINAL_BILLING", "Final billing and handover preparation", 10, 20, 0],
];

const RE_MODELS = [
  ["Classic 350", "Signals"], ["Classic 350", "Chrome"], ["Hunter 350", "Metro"], ["Bullet 350", "Standard"], ["Meteor 350", "Fireball"],
  ["Himalayan 450", "Kaza Brown"], ["Guerrilla 450", "Flash"], ["Interceptor 650", "Standard"], ["Continental GT 650", "Standard"], ["Super Meteor 650", "Astral"],
] as const;

const PARTS: [string, string, string, number, number, string[], number | null][] = [
  // partNumber, name, category, cost, price, models, warrantyMonths
  ["RE-OF-350", "Oil filter (J-platform 350)", "SPARE_PART", 140, 210, ["Classic 350", "Hunter 350", "Meteor 350", "Bullet 350"], null],
  ["RE-OF-650", "Oil filter (650 twins)", "SPARE_PART", 190, 290, ["Interceptor 650", "Continental GT 650", "Super Meteor 650"], null],
  ["RE-EO-1L", "Engine oil 15W50 synthetic (1 L)", "CONSUMABLE", 520, 720, [], null],
  ["RE-AF-350", "Air filter element 350", "SPARE_PART", 260, 390, ["Classic 350", "Hunter 350", "Meteor 350"], null],
  ["RE-BP-F350", "Front brake pad set 350", "SPARE_PART", 520, 780, ["Classic 350", "Hunter 350", "Meteor 350", "Bullet 350"], 6],
  ["RE-BP-R350", "Rear brake pad set 350", "SPARE_PART", 480, 720, ["Classic 350", "Hunter 350", "Meteor 350"], 6],
  ["RE-BP-F650", "Front brake pad set 650", "SPARE_PART", 980, 1450, ["Interceptor 650", "Continental GT 650", "Super Meteor 650"], 6],
  ["RE-CK-350", "Chain & sprocket kit 350", "SPARE_PART", 2100, 3150, ["Classic 350", "Hunter 350", "Meteor 350", "Bullet 350"], 6],
  ["RE-CL-350", "Clutch plate set 350", "SPARE_PART", 1650, 2450, ["Classic 350", "Meteor 350", "Bullet 350"], 6],
  ["RE-CC-350", "Clutch cable 350", "SPARE_PART", 230, 350, ["Classic 350", "Hunter 350", "Meteor 350"], null],
  ["RE-SP-350", "Spark plug 350", "SPARE_PART", 160, 240, ["Classic 350", "Hunter 350", "Meteor 350", "Bullet 350"], null],
  ["RE-BT-12V", "Battery 12V 8Ah", "SPARE_PART", 2300, 3200, [], 24],
  ["RE-HL-LED", "LED headlamp assembly", "SPARE_PART", 3400, 4900, ["Hunter 350", "Himalayan 450", "Guerrilla 450"], 12],
  ["RE-TY-F19", "Front tyre 100/90-19", "SPARE_PART", 2600, 3600, ["Classic 350", "Bullet 350"], 12],
  ["RE-TY-R18", "Rear tyre 120/80-18", "SPARE_PART", 3000, 4200, ["Classic 350", "Bullet 350"], 12],
  ["RE-BF-DOT4", "Brake fluid DOT 4 (250 ml)", "CONSUMABLE", 180, 260, [], null],
  ["RE-CL-LUBE", "Chain lube spray", "CONSUMABLE", 260, 380, [], null],
  ["RE-AC-CRASH", "Engine guard (accessory)", "ACCESSORY", 2900, 4200, ["Classic 350"], 12],
  ["RE-AC-TOUR", "Touring seat (accessory)", "ACCESSORY", 3600, 5200, ["Meteor 350", "Super Meteor 650"], 12],
  ["RE-RG-450", "Radiator coolant 450 (1 L)", "CONSUMABLE", 320, 460, ["Himalayan 450", "Guerrilla 450"], null],
];

async function user(email: string, name: string, roleKeys: string[], branchIds: string[], unitIds: string[] = [], type: "STAFF" | "CUSTOMER" = "STAFF") {
  const roles = await prisma.role.findMany({ where: { key: { in: roleKeys } } });
  return prisma.user.create({
    data: {
      email, name, userType: type, passwordHash: await hashPassword(DEMO_PASSWORD),
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
      branchAssignments: { create: branchIds.map((branchId, i) => ({ branchId, isPrimary: i === 0 })) },
      businessUnitAssignments: { create: unitIds.map((businessUnitId) => ({ businessUnitId })) },
    },
  });
}

const actorCache = new Map<string, Actor>();
async function as(userId: string) {
  if (!actorCache.has(userId)) actorCache.set(userId, (await loadActor(userId))!);
  return actorCache.get(userId)!;
}

/** Plain-language reasons shown to customers for the demo repairs (fills only where missing). */
const DEMO_REASONS: Record<string, string> = {
  "General periodic service": "Due at this mileage: fresh oil and filter, spark plug, and a full check of brakes, chain, lights and fasteners.",
  "Front brake pad replacement": "Front pads are worn to about 20%. Braking distance increases and the disc can get damaged if left.",
  "Clutch plate replacement": "The clutch slips when you accelerate because the plates are worn past their limit. It will get worse and can leave you stranded.",
  "Chain cleaning and adjustment": "The chain was loose and dry, which causes the noise and wears the sprockets faster.",
  "Battery replacement": "The battery failed a load test — it can't hold charge overnight, which is why the bike won't start.",
  "Headlamp wiring diagnosis": "The headlamp connector is corroded and flickers. Optional: we trace and clean the wiring so it doesn't fail at night.",
};
async function ensureDemoReasons() {
  for (const [title, description] of Object.entries(DEMO_REASONS)) {
    await prisma.repairTask.updateMany({ where: { title, description: null }, data: { description } });
  }
}

/** Department managers at Coimbatore (idempotent, safe to run on an existing demo database). */
async function ensureDepartmentManagers() {
  const cbe = await prisma.branch.findUnique({ where: { code: "RE-CBE-01" } });
  if (!cbe) return;
  const people: [string, string, string, string, string][] = [
    ["service.mgr.cbe@oxina.test", "Hari Shankar", "SERVICE_MANAGER", "OXE-1009", "Service Manager"],
    ["showroom.mgr.cbe@oxina.test", "Kavya Ramesh", "SHOWROOM_MANAGER", "OXE-1010", "Showroom Manager"],
    ["stores.mgr.cbe@oxina.test", "Murali Dharan", "STORES_MANAGER", "OXE-1011", "Stores Manager"],
  ];
  for (const [email, name, role, code, designation] of people) {
    if (await prisma.user.findUnique({ where: { email } })) continue;
    const u = await user(email, name, [role], [cbe.id]);
    await prisma.employee.create({ data: { userId: u.id, employeeCode: code, fullName: name, workEmail: email, designation, branchId: cbe.id, joiningDate: new Date("2024-04-01") } });
  }
}

async function main() {
  if (process.env.ALLOW_DEMO_SEED !== "true" || process.env.NODE_ENV === "production") {
    throw new Error("Demo seed refused: set ALLOW_DEMO_SEED=true in a development environment only.");
  }
  if (await prisma.serviceJob.count()) {
    // Existing demo database: keep the data, just bring roles and the department-manager demo users up to date.
    await syncRbac(prisma);
    await ensureDepartmentManagers();
    await ensureDemoReasons();
    console.log("Database already contains service data — roles synced, department managers and demo repair explanations filled in; no other data changed.");
    return;
  }
  await syncRbac(prisma);
  const group = (await prisma.businessGroup.findFirst()) ?? (await prisma.businessGroup.create({ data: { name: "Oxina Groups", code: "OXINA" } }));

  const unit = (name: string, code: string, type: "AUTOMOTIVE_DEALERSHIP" | "HOTEL" | "RESTAURANT", brand?: string) =>
    prisma.businessUnit.create({ data: { groupId: group.id, name, code, type, brand } });
  const re = await unit("Royal Enfield", "RE", "AUTOMOTIVE_DEALERSHIP", "Royal Enfield");
  const tata = await unit("Tata Motors", "TATA", "AUTOMOTIVE_DEALERSHIP", "Tata");
  const hyu = await unit("Hyundai", "HYU", "AUTOMOTIVE_DEALERSHIP", "Hyundai");
  const suz = await unit("Suzuki", "SUZ", "AUTOMOTIVE_DEALERSHIP", "Suzuki");
  const hotels = await unit("Oxina Hotels", "HTL", "HOTEL");
  const rest = await unit("Oxina Restaurants", "RST", "RESTAURANT");

  const branch = async (businessUnitId: string, name: string, code: string, city: string, phone: string) => {
    const b = await prisma.branch.create({ data: { businessUnitId, name, code, city, state: "Tamil Nadu", stateCode: "33", addressLine: `${name} campus`, phone, email: `${code.toLowerCase()}@oxina.test`, gstin: "33AAAAA0000A1Z5", serviceBays: 6 } });
    await prisma.inventoryLocation.createMany({ data: [{ branchId: b.id, code: "WH", name: "Main Warehouse", type: "WAREHOUSE" }, { branchId: b.id, code: "SVC", name: "Service Parts Store", type: "SERVICE_STORE" }] });
    await prisma.department.createMany({ data: ["Showroom", "Service", "Warehouse", "Accounts"].map((n) => ({ branchId: b.id, name: n, type: n.toUpperCase() })) });
    return b;
  };
  const cbe = await branch(re.id, "Royal Enfield — Coimbatore", "RE-CBE-01", "Coimbatore", "+91 422 400 1001");
  const tpr = await branch(re.id, "Royal Enfield — Tiruppur", "RE-TPR-01", "Tiruppur", "+91 421 400 2002");
  const slm = await branch(re.id, "Royal Enfield — Salem", "RE-SLM-01", "Salem", "+91 427 400 3003");
  await branch(tata.id, "Tata Motors — Coimbatore", "TATA-CBE-01", "Coimbatore", "+91 422 400 4004");
  await branch(hyu.id, "Hyundai — Coimbatore", "HYU-CBE-01", "Coimbatore", "+91 422 400 5005");
  await branch(suz.id, "Suzuki — Erode", "SUZ-ERD-01", "Erode", "+91 424 400 6006");
  await branch(hotels.id, "Oxina Residency — Ooty", "HTL-OTY-01", "Ooty", "+91 423 400 7007");
  await branch(rest.id, "Oxina Kitchen — RS Puram", "RST-CBE-01", "Coimbatore", "+91 422 400 8008");

  await prisma.repairDurationStandard.createMany({ data: DURATIONS.map(([taskKey, label, minMinutes, maxMinutes, defaultLabour]) => ({ businessUnitId: re.id, taskKey, label, minMinutes, maxMinutes, defaultLabour })) });
  await prisma.inspectionChecklistTemplate.create({ data: { businessUnitId: re.id, kind: "QUALITY", name: "Royal Enfield standard QC", items: DEFAULT_QC_CHECKLIST as never } });
  await prisma.notificationTemplate.createMany({ data: DEFAULT_TEMPLATES.map((t) => ({ key: t.key, channel: t.channel, subject: t.subject ?? null, body: t.body })) });

  const models: Awaited<ReturnType<typeof prisma.vehicleModel.create>>[] = [];
  for (const [name, variant] of RE_MODELS) models.push(await prisma.vehicleModel.create({ data: { businessUnitId: re.id, brand: "Royal Enfield", name, variant, category: "MOTORCYCLE", engineCc: Number(name.match(/\d{3}/)![0]) } }));
  const modelByName = (n: string) => models.find((m) => m.name === n)!;

  const sup1 = await prisma.supplier.create({ data: { businessUnitId: re.id, code: "RE-OEM", name: "Royal Enfield Genuine Parts (fictional)", phone: "+91 44 0000 0000", leadTimeDays: 4 } });
  const sup2 = await prisma.supplier.create({ data: { businessUnitId: re.id, code: "KOVAI-AUTO", name: "Kovai Auto Spares (fictional)", phone: "+91 422 000 0000", leadTimeDays: 2 } });
  const items: Awaited<ReturnType<typeof prisma.inventoryItem.create>>[] = [];
  for (const [pn, name, cat, cost, price, compat, w] of PARTS) {
    items.push(await prisma.inventoryItem.create({ data: { businessUnitId: re.id, partNumber: pn, name, category: cat as never, manufacturer: "Royal Enfield", defaultSupplierId: cat === "CONSUMABLE" ? sup2.id : sup1.id, purchaseCost: cost, sellingPrice: price, taxRatePercent: 18, hsnCode: cat === "CONSUMABLE" ? "2710" : "8714", compatibleModels: compat, warrantyMonths: w, unit: "pcs" } }));
  }
  const item = (pn: string) => items.find((i) => i.partNumber === pn)!;

  // ── Staff ──
  const admin = await user("admin@oxina.test", "Arun Prakash (Demo Admin)", ["SUPER_ADMIN"], []);
  const owner = await user("owner@oxina.test", "Meena Raghavan", ["GROUP_OWNER"], [], [re.id, tata.id]);
  const mgrCbe = await user("manager.cbe@oxina.test", "Karthik Subramanian", ["BRANCH_MANAGER"], [cbe.id]);
  const mgrTpr = await user("manager.tpr@oxina.test", "Divya Natarajan", ["BRANCH_MANAGER"], [tpr.id]);
  const advCbe = await user("advisor.cbe@oxina.test", "Suresh Kumar", ["SERVICE_ADVISOR"], [cbe.id]);
  const billCbe = await user("billing.cbe@oxina.test", "Lakshmi Priya", ["BILLING_EXECUTIVE"], [cbe.id]);
  const stockCbe = await user("stock.cbe@oxina.test", "Ramesh Babu", ["WAREHOUSE_EXECUTIVE"], [cbe.id]);
  const salesCbe = await user("sales.cbe@oxina.test", "Priya Venkatesh", ["SALES_EXECUTIVE"], [cbe.id]);
  const mech1 = await user("mech1.cbe@oxina.test", "Manikandan R", ["MECHANIC"], [cbe.id]);
  const mech2 = await user("mech2.cbe@oxina.test", "Vignesh S", ["MECHANIC"], [cbe.id]);
  const qcCbe = await user("qc.cbe@oxina.test", "Balaji Mohan", ["QUALITY_INSPECTOR"], [cbe.id]);
  const advTpr = await user("advisor.tpr@oxina.test", "Gokul Raj", ["SERVICE_ADVISOR"], [tpr.id]);
  const mechTpr = await user("mech.tpr@oxina.test", "Saravanan K", ["MECHANIC"], [tpr.id]);
  await user("oem.re@oxina.test", "Royal Enfield OEM Liaison (fictional)", ["OEM_REPRESENTATIVE"], [], [re.id]);
  void admin; void owner; void slm;

  const staff: [typeof mgrCbe, string, string, string][] = [
    [mgrCbe, "OXE-1001", "Branch Manager", cbe.id], [advCbe, "OXE-1002", "Service Advisor", cbe.id], [billCbe, "OXE-1003", "Billing Executive", cbe.id],
    [stockCbe, "OXE-1004", "Parts Executive", cbe.id], [salesCbe, "OXE-1005", "Sales Executive", cbe.id], [mech1, "OXE-1006", "Senior Technician", cbe.id],
    [mech2, "OXE-1007", "Technician", cbe.id], [qcCbe, "OXE-1008", "Quality Inspector", cbe.id], [mgrTpr, "OXE-2001", "Branch Manager", tpr.id],
    [advTpr, "OXE-2002", "Service Advisor", tpr.id], [mechTpr, "OXE-2003", "Technician", tpr.id],
  ];
  for (const [u, code, designation, b] of staff) {
    await prisma.employee.create({ data: { userId: u.id, employeeCode: code, fullName: u.name, workEmail: u.email, designation, branchId: b, joiningDate: new Date("2024-04-01") } });
  }

  // ── Stock ──
  for (const b of [cbe, tpr, slm]) {
    const loc = await prisma.inventoryLocation.findFirstOrThrow({ where: { branchId: b.id, code: "SVC" } });
    for (const it of items) {
      // Deliberately leave clutch plates & headlamps out of stock at Coimbatore to demo shortages.
      const qty = b.id === cbe.id && (it.partNumber === "RE-CL-350" || it.partNumber === "RE-HL-LED") ? 0 : it.category === "CONSUMABLE" ? 40 : 8;
      await prisma.inventoryBalance.create({ data: { itemId: it.id, locationId: loc.id, branchId: b.id, quantityOnHand: qty, minStockLevel: it.category === "CONSUMABLE" ? 10 : 2, reorderQuantity: it.category === "CONSUMABLE" ? 30 : 6 } });
      if (qty) await prisma.stockMovement.create({ data: { itemId: it.id, locationId: loc.id, branchId: b.id, type: "RECEIPT", quantityDelta: qty, onHandAfter: qty, reservedAfter: 0, unitCost: it.purchaseCost, reason: "Opening stock (demo)", referenceType: "OPENING", performedById: stockCbe.id } });
    }
  }

  // ── Showroom stock ──
  const colours = ["Stealth Black", "Dapper Grey", "Rebel Blue", "Commando Sand", "Chrome Red"];
  let n = 0;
  for (const m of models) {
    for (const b of [cbe, tpr]) {
      n++;
      const ex = m.engineCc! >= 650 ? 320000 : m.engineCc! >= 450 ? 260000 : 185000 + n * 1000;
      await prisma.vehicle.create({
        data: { branchId: b.id, vehicleModelId: m.id, modelYear: 2026, colour: colours[n % colours.length], vin: `ME3DEMO${String(100000 + n).padStart(10, "0")}`, engineNumber: `ENDEMO${String(5000 + n)}`, stockLocation: "Showroom floor", purchaseCost: Math.round(ex * 0.88), exShowroomPrice: ex, insuranceCharges: 9800, registrationCharges: Math.round(ex * 0.1), accessoriesCharges: 0, onRoadPrice: ex + 9800 + Math.round(ex * 0.1) },
      });
    }
  }

  // ── Customers (one with portal access) ──
  const custUser1 = await user("customer.anand@oxina.test", "Anand Krishnan", ["CUSTOMER"], [], [], "CUSTOMER");
  const custUser2 = await user("customer.fathima@oxina.test", "Fathima Begum", ["CUSTOMER"], [], [], "CUSTOMER");
  const mk = async (code: string, fullName: string, phone: string, email: string, userId: string | null, b: string) =>
    prisma.customer.create({ data: { customerCode: code, fullName, phone, email, userId, createdAtBranchId: b, city: "Coimbatore", stateCode: "33" } });
  const c1 = await mk("CUS-RE-2026-000001", "Anand Krishnan", "+919800000001", "customer.anand@oxina.test", custUser1.id, cbe.id);
  const c2 = await mk("CUS-RE-2026-000002", "Fathima Begum", "+919800000002", "customer.fathima@oxina.test", custUser2.id, cbe.id);
  const c3 = await mk("CUS-RE-2026-000003", "Rahul Menon", "+919800000003", "rahul.menon@example.test", null, cbe.id);
  const c4 = await mk("CUS-RE-2026-000004", "Senthil Murugan", "+919800000004", "senthil@example.test", null, tpr.id);
  await prisma.numberSequence.create({ data: { key: `CUST:RE:${new Date().getUTCFullYear()}`, nextValue: 5 } });

  // ── Service jobs, driven through the real workflow ──
  const A = { adv: await as(advCbe.id), bill: await as(billCbe.id), stock: await as(stockCbe.id), m1: await as(mech1.id), m2: await as(mech2.id), qc: await as(qcCbe.id), mgr: await as(mgrCbe.id), advT: await as(advTpr.id), mechT: await as(mechTpr.id) };
  const cust1 = await as(custUser1.id);
  const taskId = async (jobId: string, title: string) => (await prisma.repairTask.findFirstOrThrow({ where: { jobId, title } })).id;
  const approveAll = async (actor: Actor, jobId: string) => {
    const est = await prisma.repairEstimate.findFirstOrThrow({ where: { jobId, status: "DRAFT" }, include: { lines: true } });
    await sendEstimate(A.adv, est.id, "Please review and approve.");
    const isCustomer = actor.kind === "CUSTOMER";
    await decideEstimate(actor, est.id, { decisions: est.lines.filter((l) => l.approvalStatus === "PENDING").map((l) => ({ lineId: l.id, decision: "APPROVED" as const })), channel: isCustomer ? "PORTAL" : "IN_PERSON" });
  };
  const runTask = async (mech: Actor, id: string) => {
    await transitionTask(mech, id, { action: "START" });
    await transitionTask(mech, id, { action: "COMPLETE" });
  };
  const issueAll = async (jobId: string, mechId: string) => {
    for (const r of await prisma.sparePartRequest.findMany({ where: { jobId, status: "RESERVED" } })) await issuePart(A.stock, r.id, { receivedByMechanicId: mechId });
  };

  // Job 1 — Anand: Classic 350 periodic service → delivered & closed.
  const j1 = await createServiceJob(A.adv, { branchId: cbe.id, customerId: c1.id, vehicle: { registrationNumber: "TN37DX4521", vehicleModelId: modelByName("Classic 350").id, modelName: "Classic 350 Signals" }, serviceType: "PERIODIC_SERVICE", isEmergency: false, odometerIn: 9850, fuelLevel: "HALF", reportedProblems: "10,000 km periodic service. Slight brake noise at front.", accessoriesReceived: ["Helmet"], existingDamage: "Minor scratch on left tank panel" });
  await startInspection(A.adv, j1.id);
  await completeInspection(A.adv, j1.id, {
    checklist: [{ key: "brakes", label: "Brakes", result: "ATTENTION" }, { key: "chain", label: "Chain", result: "OK" }],
    findings: "Front pads at 20%. Oil due.", safetyCritical: false, customerSummary: "Periodic service due and front brake pads are worn — replacement recommended.", internalNotes: "Customer prefers genuine parts only.",
    tasks: [
      { title: "General periodic service", taskKey: "PERIODIC_SERVICE", labourCharge: 900, isOptional: false, isSafetyCritical: false, dependsOn: [], parts: [{ itemId: item("RE-OF-350").id, quantity: 1 }, { itemId: item("RE-EO-1L").id, quantity: 2 }, { itemId: item("RE-SP-350").id, quantity: 1 }] },
      { title: "Front brake pad replacement", taskKey: "BRAKE_PADS", labourCharge: 400, isOptional: false, isSafetyCritical: true, dependsOn: [], parts: [{ itemId: item("RE-BP-F350").id, quantity: 1 }] },
    ],
  });
  await approveAll(cust1, j1.id);
  await verifyPartsAndRequest(A.bill, j1.id);
  await assignTaskMechanic(A.adv, await taskId(j1.id, "General periodic service"), { mechanicId: mech1.id });
  await assignTaskMechanic(A.adv, await taskId(j1.id, "Front brake pad replacement"), { mechanicId: mech2.id });
  const r1 = await prisma.sparePartRequest.findMany({ where: { jobId: j1.id } });
  for (const r of r1) await issuePart(A.stock, r.id, { receivedByMechanicId: r.repairTaskId === (await taskId(j1.id, "General periodic service")) ? mech1.id : mech2.id });
  await runTask(A.m1, await taskId(j1.id, "General periodic service"));
  await runTask(A.m2, await taskId(j1.id, "Front brake pad replacement"));
  const qc1 = await startQualityInspection(A.qc, j1.id);
  await startTestRide(A.qc, qc1.id, { odometerStart: 9850 });
  const ride1 = await prisma.testRide.findFirstOrThrow({ where: { qualityInspectionId: qc1.id } });
  await endTestRide(A.qc, ride1.id, { odometerEnd: 9856, observations: "Brakes firm, no noise.", result: "OK" });
  await completeQualityInspection(A.qc, qc1.id, { checklist: DEFAULT_QC_CHECKLIST.map((c) => ({ key: c.key, result: "PASS" as const })), testRideRequired: true, result: "PASSED", returnTaskIds: [] });
  const inv1 = await buildServiceInvoice(A.bill, j1.id);
  await finalizeInvoice(A.bill, inv1.id);
  const due1 = await prisma.invoice.findUniqueOrThrow({ where: { id: inv1.id } });
  await recordPayment(A.bill, { invoiceId: inv1.id, amount: Number(due1.balanceDue), method: "UPI", reference: "UPI-DEMO-0001", confirmNow: true });
  await markReadyForDelivery(A.adv, j1.id);
  await handoverVehicle(A.adv, j1.id, { recipientName: "Anand Krishnan", recipientRelation: "OWNER", odometerOut: 9856, checklist: { vehicleInspectedWithCustomer: true, accessoriesReturned: true, invoiceExplained: true, oldPartsOffered: true }, customerAcknowledged: true });

  // Job 2 — Anand's second bike: clutch repair blocked by unavailable part (with procurement date).
  const j2 = await createServiceJob(A.adv, { branchId: cbe.id, customerId: c1.id, vehicle: { registrationNumber: "TN37EA7788", vehicleModelId: modelByName("Meteor 350").id, modelName: "Meteor 350 Fireball" }, serviceType: "GENERAL_REPAIR", isEmergency: false, odometerIn: 23410, fuelLevel: "QUARTER", reportedProblems: "Clutch slipping under acceleration; chain noisy.", accessoriesReceived: [] });
  await startInspection(A.adv, j2.id);
  await completeInspection(A.adv, j2.id, {
    checklist: [{ key: "clutch", label: "Clutch", result: "FAIL" }, { key: "chain", label: "Chain", result: "ATTENTION" }],
    findings: "Clutch plates worn beyond limit. Chain slack.", safetyCritical: false, customerSummary: "Clutch plates are worn and need replacement; the chain needs adjustment.",
    tasks: [
      { title: "Clutch plate replacement", taskKey: "CLUTCH", labourCharge: 1500, isOptional: false, isSafetyCritical: false, dependsOn: [], parts: [{ itemId: item("RE-CL-350").id, quantity: 1 }, { itemId: item("RE-EO-1L").id, quantity: 2 }] },
      { title: "Chain cleaning and adjustment", taskKey: "CHAIN_ADJUST", labourCharge: 200, isOptional: false, isSafetyCritical: false, dependsOn: [], parts: [{ itemId: item("RE-CL-LUBE").id, quantity: 1 }] },
    ],
  });
  await approveAll(cust1, j2.id);
  await verifyPartsAndRequest(A.bill, j2.id);
  await assignTaskMechanic(A.adv, await taskId(j2.id, "Clutch plate replacement"), { mechanicId: mech1.id });
  await assignTaskMechanic(A.adv, await taskId(j2.id, "Chain cleaning and adjustment"), { mechanicId: mech2.id });
  await issueAll(j2.id, mech2.id);
  await runTask(A.m2, await taskId(j2.id, "Chain cleaning and adjustment"));
  const missing = await prisma.sparePartRequest.findFirstOrThrow({ where: { jobId: j2.id, status: "UNAVAILABLE" } });
  await recordProcurement(A.stock, missing.id, { expectedAvailableAt: new Date(Date.now() + 2 * 86400_000), note: "Ordered from RE Genuine Parts; dispatch confirmed by phone." });

  // Job 3 — Fathima: awaiting estimate approval in the portal.
  const j3 = await createServiceJob(A.adv, { branchId: cbe.id, customerId: c2.id, vehicle: { registrationNumber: "TN38CK1203", vehicleModelId: modelByName("Hunter 350").id, modelName: "Hunter 350 Metro" }, serviceType: "GENERAL_REPAIR", isEmergency: false, odometerIn: 5120, fuelLevel: "FULL", reportedProblems: "Battery drains overnight; headlight flickers.", accessoriesReceived: ["Phone mount"] });
  await startInspection(A.adv, j3.id);
  await completeInspection(A.adv, j3.id, {
    checklist: [{ key: "battery", label: "Battery", result: "FAIL" }, { key: "lights", label: "Lights", result: "ATTENTION" }],
    findings: "Battery fails load test. Headlamp connector corroded.", safetyCritical: false, customerSummary: "Your battery has failed a load test and should be replaced. We also recommend an electrical check of the headlamp wiring.",
    tasks: [
      { title: "Battery replacement", taskKey: "BATTERY", labourCharge: 150, isOptional: false, isSafetyCritical: false, dependsOn: [], parts: [{ itemId: item("RE-BT-12V").id, quantity: 1 }] },
      { title: "Headlamp wiring diagnosis", taskKey: "ELEC_BASIC", labourCharge: 400, isOptional: true, isSafetyCritical: false, dependsOn: [], parts: [] },
    ],
  });
  const est3 = await prisma.repairEstimate.findFirstOrThrow({ where: { jobId: j3.id } });
  await sendEstimate(A.adv, est3.id, "The headlamp check is optional.");

  // Job 4 — Rahul (no portal): repair in progress.
  const j4 = await createServiceJob(A.adv, { branchId: cbe.id, newCustomer: undefined, customerId: c3.id, vehicle: { registrationNumber: "KL10AB3344", vehicleModelId: modelByName("Interceptor 650").id, modelName: "Interceptor 650" }, serviceType: "PERIODIC_SERVICE", isEmergency: false, odometerIn: 15200, fuelLevel: "HALF", reportedProblems: "15,000 km service.", accessoriesReceived: [] });
  await startInspection(A.adv, j4.id);
  await completeInspection(A.adv, j4.id, {
    checklist: [], findings: "Routine.", safetyCritical: false, customerSummary: "Routine periodic service.",
    tasks: [{ title: "General periodic service", taskKey: "PERIODIC_SERVICE", labourCharge: 1100, isOptional: false, isSafetyCritical: false, dependsOn: [], parts: [{ itemId: item("RE-OF-650").id, quantity: 1 }, { itemId: item("RE-EO-1L").id, quantity: 3 }] }],
  });
  await approveAll(A.adv, j4.id);
  await verifyPartsAndRequest(A.bill, j4.id);
  await assignTaskMechanic(A.adv, await taskId(j4.id, "General periodic service"), { mechanicId: mech1.id });
  await issueAll(j4.id, mech1.id);
  await transitionTask(A.m1, await taskId(j4.id, "General periodic service"), { action: "START" });

  // Job 5 — just received at Coimbatore.
  await createServiceJob(A.adv, { branchId: cbe.id, customerId: c2.id, vehicle: { registrationNumber: "TN38CZ9001", vehicleModelId: modelByName("Classic 350").id, modelName: "Classic 350 Chrome" }, serviceType: "FREE_SERVICE", isEmergency: false, odometerIn: 1020, fuelLevel: "HALF", reportedProblems: "First free service.", accessoriesReceived: [] });

  // Job 6 — Tiruppur branch (used to demonstrate branch isolation).
  await createServiceJob(A.advT, { branchId: tpr.id, customerId: c4.id, vehicle: { registrationNumber: "TN39BQ5566", vehicleModelId: modelByName("Bullet 350").id, modelName: "Bullet 350" }, serviceType: "GENERAL_REPAIR", isEmergency: false, odometerIn: 30500, fuelLevel: "HALF", reportedProblems: "Rear tyre worn; vibration at speed.", accessoriesReceived: [] });

  // ── Showroom pipeline ──
  await prisma.salesLead.createMany({
    data: [
      { branchId: cbe.id, name: "Deepak Iyer", phone: "+919800000010", source: "WALK_IN", interestedModelId: modelByName("Himalayan 450").id, assignedToId: salesCbe.id, status: "CONTACTED", nextFollowUpAt: new Date(Date.now() + 86400_000) },
      { branchId: cbe.id, name: "Nisha Thomas", phone: "+919800000011", source: "WEBSITE", interestedModelId: modelByName("Hunter 350").id, assignedToId: salesCbe.id, status: "NEW", nextFollowUpAt: new Date(Date.now() + 3600_000) },
      { branchId: cbe.id, name: "Vijay Anand", phone: "+919800000012", source: "REFERRAL", interestedModelId: modelByName("Super Meteor 650").id, assignedToId: salesCbe.id, status: "LOST", lostReason: "Budget — chose a used bike" },
    ],
  });
  await prisma.offer.create({
    data: { businessUnitId: re.id, branchId: cbe.id, name: "Festive accessory offer", description: "Flat ₹2,000 off on new bookings", appliesTo: "VEHICLE_SALE", discountType: "FLAT", discountValue: 2000, startsAt: new Date(Date.now() - 7 * 86400_000), endsAt: new Date(Date.now() + 30 * 86400_000), createdById: mgrCbe.id, coupons: { create: [{ code: "FESTIVE2000", usageLimit: 50 }] } },
  });

  await ensureDepartmentManagers();
  await ensureDemoReasons();
  console.log("Demo data ready. Demo password for all *@oxina.test accounts:", DEMO_PASSWORD);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
