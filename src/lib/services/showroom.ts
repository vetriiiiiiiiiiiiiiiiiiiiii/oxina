import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { conflict, forbidden, invalid, notFound, rule } from "@/lib/errors";
import { assertBranch, branchFilter, can, requirePermission, type Actor } from "@/lib/rbac/actor";
import { audit } from "@/lib/audit";
import { nextNumber } from "@/lib/numbering";
import { D, ZERO, round2, sum } from "@/lib/money";
import { createCustomerTx, customerInput, phoneSchema } from "./customers";
import { getBranchSetting } from "./settings";
import { writeInvoiceTotals } from "./billing";

// ─── Vehicle inventory ───

const money = z.coerce.number().min(0).max(100_000_000);

export const vehicleInput = z.object({
  branchId: z.string().uuid(),
  vehicleModelId: z.string().uuid(),
  modelYear: z.coerce.number().int().min(2000).max(2100),
  colour: z.string().trim().min(2).max(40),
  vin: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{11,17}$/, "Chassis number must be 11–17 letters/digits"),
  engineNumber: z.string().trim().toUpperCase().min(5).max(25),
  stockLocation: z.string().trim().max(60).optional(),
  purchaseCost: money,
  exShowroomPrice: money,
  insuranceCharges: money.default(0),
  registrationCharges: money.default(0),
  accessoriesCharges: money.default(0),
  fittingCharges: money.default(0),
  otherCharges: money.default(0),
  expectedDeliveryDate: z.coerce.date().optional(),
});

const onRoad = (v: { exShowroomPrice: number; insuranceCharges: number; registrationCharges: number; accessoriesCharges: number; fittingCharges: number; otherCharges: number }) =>
  round2(sum([v.exShowroomPrice, v.insuranceCharges, v.registrationCharges, v.accessoriesCharges, v.fittingCharges, v.otherCharges]));

export async function addVehicle(actor: Actor, input: z.infer<typeof vehicleInput>) {
  requirePermission(actor, "vehicles.manage");
  assertBranch(actor, input.branchId, "Branch");
  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: input.branchId } });
    const model = await tx.vehicleModel.findFirst({ where: { id: input.vehicleModelId, businessUnitId: branch.businessUnitId } });
    if (!model) throw invalid("Model does not belong to this business.");
    const v = await tx.vehicle.create({ data: { ...input, onRoadPrice: onRoad(input) } });
    await audit(tx, { actorId: actor.userId, action: "vehicle.add", entityType: "Vehicle", entityId: v.id, branchId: v.branchId, after: { vin: v.vin } });
    return v;
  });
}

export const vehiclePricingInput = vehicleInput.pick({ exShowroomPrice: true, insuranceCharges: true, registrationCharges: true, accessoriesCharges: true, fittingCharges: true, otherCharges: true });

export async function updateVehiclePricing(actor: Actor, id: string, input: z.infer<typeof vehiclePricingInput>) {
  requirePermission(actor, "showroom.pricing.approve");
  const v = await prisma.vehicle.findUnique({ where: { id } });
  if (!v) throw notFound("Vehicle");
  assertBranch(actor, v.branchId, "Vehicle");
  if (["DELIVERED", "TRANSFERRED", "RETURNED"].includes(v.status)) throw rule("Pricing cannot change after delivery.");
  return prisma.$transaction(async (tx) => {
    const after = await tx.vehicle.update({ where: { id }, data: { ...input, onRoadPrice: onRoad(input) } });
    await audit(tx, { actorId: actor.userId, action: "vehicle.pricing", entityType: "Vehicle", entityId: id, branchId: v.branchId, before: v, after });
    return after;
  });
}

export const vehicleQuery = z.object({ branchId: z.string().uuid().optional(), status: z.string().optional(), search: z.string().trim().max(40).optional() });

export async function listVehicles(actor: Actor, q: z.infer<typeof vehicleQuery>) {
  requirePermission(actor, "vehicles.view");
  const rows = await prisma.vehicle.findMany({
    where: {
      ...branchFilter(actor, q.branchId),
      ...(q.status ? { status: q.status as never } : { status: { notIn: ["DELIVERED", "TRANSFERRED", "RETURNED"] } }),
      ...(q.search ? { OR: [{ vin: { contains: q.search, mode: "insensitive" } }, { vehicleModel: { name: { contains: q.search, mode: "insensitive" } } }, { colour: { contains: q.search, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ status: "asc" }, { receivedAt: "desc" }],
    take: 300,
    include: { vehicleModel: true, branch: { select: { name: true } }, bookings: { where: { status: { not: "CANCELLED" } }, select: { bookingNumber: true, customer: { select: { fullName: true } } } } },
  });
  const cost = can(actor, "vehicles.cost.view");
  return rows.map((r) => ({ ...r, purchaseCost: cost ? r.purchaseCost : null }));
}

// ─── Leads ───

export const leadInput = z.object({
  branchId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("").transform(() => undefined)),
  interestedModelId: z.string().uuid().optional(),
  source: z.enum(["WALK_IN", "PHONE", "WEBSITE", "REFERRAL", "CAMPAIGN"]),
  assignedToId: z.string().uuid().optional(),
  nextFollowUpAt: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function createLead(actor: Actor, input: z.infer<typeof leadInput>) {
  requirePermission(actor, "showroom.leads.manage");
  assertBranch(actor, input.branchId, "Branch");
  const assignee = input.assignedToId ?? actor.userId;
  return prisma.$transaction(async (tx) => {
    const ok = await tx.userBranchAssignment.findFirst({ where: { userId: assignee, branchId: input.branchId } });
    if (!ok && !actor.allBranches) throw invalid("Assignee is not in this branch.");
    const existing = await tx.customer.findFirst({ where: { phone: input.phone }, select: { id: true } });
    const lead = await tx.salesLead.create({ data: { ...input, assignedToId: assignee, customerId: existing?.id ?? null } });
    await tx.leadActivity.create({ data: { leadId: lead.id, type: "NOTE", notes: `Lead created (${input.source})`, createdById: actor.userId } });
    await audit(tx, { actorId: actor.userId, action: "lead.create", entityType: "SalesLead", entityId: lead.id, branchId: input.branchId });
    return lead;
  });
}

async function loadLead(actor: Actor, id: string) {
  const lead = await prisma.salesLead.findUnique({ where: { id } });
  if (!lead) throw notFound("Lead");
  assertBranch(actor, lead.branchId, "Lead");
  // Sales executives work their own leads; managers see the branch.
  if (!can(actor, "showroom.pricing.approve") && lead.assignedToId && lead.assignedToId !== actor.userId) throw notFound("Lead");
  return lead;
}

export const leadActivityInput = z.object({
  type: z.enum(["CALL", "VISIT", "WHATSAPP", "EMAIL", "NOTE"]),
  outcome: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  status: z.enum(["NEW", "CONTACTED", "TEST_RIDE_SCHEDULED", "QUOTED", "BOOKED", "LOST"]).optional(),
  lostReason: z.string().trim().max(300).optional(),
  nextFollowUpAt: z.coerce.date().nullable().optional(),
});

export async function logLeadActivity(actor: Actor, leadId: string, input: z.infer<typeof leadActivityInput>) {
  requirePermission(actor, "showroom.leads.manage");
  const lead = await loadLead(actor, leadId);
  if (input.status === "LOST" && !input.lostReason) throw invalid("Record why the lead was lost.");
  return prisma.$transaction(async (tx) => {
    await tx.leadActivity.create({ data: { leadId, type: input.type, outcome: input.outcome, notes: input.notes, createdById: actor.userId } });
    await tx.salesLead.update({
      where: { id: leadId },
      data: { status: input.status ?? (lead.status === "NEW" ? "CONTACTED" : lead.status), lostReason: input.lostReason, nextFollowUpAt: input.nextFollowUpAt === undefined ? lead.nextFollowUpAt : input.nextFollowUpAt },
    });
  });
}

export const testRideInput = z.object({ vehicleModelId: z.string().uuid(), scheduledAt: z.coerce.date() });

export async function scheduleShowroomTestRide(actor: Actor, leadId: string, input: z.infer<typeof testRideInput>) {
  requirePermission(actor, "showroom.leads.manage");
  const lead = await loadLead(actor, leadId);
  return prisma.$transaction(async (tx) => {
    const r = await tx.showroomTestRide.create({ data: { branchId: lead.branchId, leadId, vehicleModelId: input.vehicleModelId, scheduledAt: input.scheduledAt, createdById: actor.userId } });
    await tx.salesLead.update({ where: { id: leadId }, data: { status: "TEST_RIDE_SCHEDULED", nextFollowUpAt: input.scheduledAt } });
    await tx.leadActivity.create({ data: { leadId, type: "NOTE", notes: `Test ride scheduled`, createdById: actor.userId } });
    return r;
  });
}

export async function completeShowroomTestRide(actor: Actor, rideId: string, status: "COMPLETED" | "NO_SHOW" | "CANCELLED", feedback?: string) {
  requirePermission(actor, "showroom.leads.manage");
  const r = await prisma.showroomTestRide.findUnique({ where: { id: rideId } });
  if (!r) throw notFound("Test ride");
  await loadLead(actor, r.leadId);
  if (r.status !== "SCHEDULED") throw rule("Test ride already closed.");
  return prisma.showroomTestRide.update({ where: { id: rideId }, data: { status, feedback, completedAt: new Date() } });
}

export async function listLeads(actor: Actor, q: { branchId?: string; status?: string; mine?: boolean }) {
  requirePermission(actor, "showroom.view");
  const own = !can(actor, "showroom.pricing.approve") || q.mine;
  return prisma.salesLead.findMany({
    where: { ...branchFilter(actor, q.branchId), ...(q.status ? { status: q.status as never } : {}), ...(own ? { assignedToId: actor.userId } : {}) },
    orderBy: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 300,
    include: { interestedModel: { select: { name: true, variant: true } }, assignedTo: { select: { name: true } }, branch: { select: { name: true } } },
  });
}

export async function getLead(actor: Actor, id: string) {
  requirePermission(actor, "showroom.view");
  await loadLead(actor, id);
  return prisma.salesLead.findUniqueOrThrow({
    where: { id },
    include: {
      interestedModel: true, assignedTo: { select: { name: true } }, branch: true,
      activities: { orderBy: { createdAt: "desc" } }, quotations: { orderBy: { createdAt: "desc" }, include: { vehicleModel: true } }, testRides: { include: { vehicleModel: true }, orderBy: { scheduledAt: "desc" } },
    },
  });
}

// ─── Quotations ───

export const quotationInput = z.object({
  leadId: z.string().uuid(),
  vehicleModelId: z.string().uuid(),
  exShowroomPrice: money,
  insuranceCharges: money.default(0),
  registrationCharges: money.default(0),
  accessoriesCharges: money.default(0),
  otherCharges: money.default(0),
  discountAmount: money.default(0),
  validDays: z.coerce.number().int().min(1).max(60).default(7),
});

export async function createQuotation(actor: Actor, input: z.infer<typeof quotationInput>) {
  requirePermission(actor, "showroom.quotations.manage");
  const lead = await loadLead(actor, input.leadId);
  if (input.discountAmount > 0 && !can(actor, "showroom.pricing.approve")) throw forbidden("Discounts on quotations need pricing approval rights.");
  const total = round2(sum([input.exShowroomPrice, input.insuranceCharges, input.registrationCharges, input.accessoriesCharges, input.otherCharges]).minus(input.discountAmount));
  if (total.isNegative()) throw invalid("Discount exceeds the quotation value.");
  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: lead.branchId }, include: { businessUnit: true } });
    const { validDays, leadId, ...rest } = input;
    const q = await tx.salesQuotation.create({
      data: { ...rest, leadId, quotationNumber: await nextNumber(tx, "QTN", branch.businessUnit.code), branchId: lead.branchId, customerId: lead.customerId, totalAmount: total, validUntil: new Date(Date.now() + validDays * 86400_000), createdById: actor.userId },
    });
    await tx.salesLead.update({ where: { id: leadId }, data: { status: "QUOTED" } });
    await tx.leadActivity.create({ data: { leadId, type: "NOTE", notes: `Quotation ${q.quotationNumber} issued`, createdById: actor.userId } });
    await audit(tx, { actorId: actor.userId, action: "quotation.create", entityType: "SalesQuotation", entityId: q.id, branchId: lead.branchId, after: { total } });
    return q;
  });
}

// ─── Coupons ───

export async function validateCoupon(tx: Tx, code: string, ctx: { businessUnitId: string; branchId: string; appliesTo: string; orderValue: Prisma.Decimal; customerId: string }) {
  const coupon = await tx.coupon.findUnique({ where: { code: code.trim().toUpperCase() }, include: { offer: true } });
  const now = new Date();
  if (!coupon || !coupon.isActive || !coupon.offer.isActive) throw invalid("Coupon is not valid.");
  const o = coupon.offer;
  if (o.businessUnitId !== ctx.businessUnitId || (o.branchId && o.branchId !== ctx.branchId)) throw invalid("Coupon is not valid at this branch.");
  if (o.appliesTo !== ctx.appliesTo) throw invalid("Coupon does not apply to this purchase.");
  if (now < o.startsAt || now > o.endsAt) throw invalid("Coupon has expired or is not yet active.");
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) throw invalid("Coupon usage limit reached.");
  if (o.minOrderValue && ctx.orderValue.lessThan(o.minOrderValue)) throw invalid("Order value is below the coupon minimum.");
  const used = await tx.couponRedemption.count({ where: { couponId: coupon.id, customerId: ctx.customerId } });
  if (used >= coupon.perCustomerLimit) throw invalid("Coupon already used by this customer.");
  let discount = o.discountType === "PERCENT" ? ctx.orderValue.times(o.discountValue).dividedBy(100) : D(o.discountValue);
  if (o.maxDiscount && discount.greaterThan(o.maxDiscount)) discount = D(o.maxDiscount);
  if (discount.greaterThan(ctx.orderValue)) discount = ctx.orderValue;
  return { coupon, discount: round2(discount) };
}

// ─── Bookings ───

export const bookingInput = z.object({
  branchId: z.string().uuid(),
  leadId: z.string().uuid().optional(),
  quotationId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  newCustomer: customerInput.optional(),
  vehicleModelId: z.string().uuid(),
  vehicleId: z.string().uuid().optional(),
  discountAmount: money.default(0),
  couponCode: z.string().trim().max(30).optional(),
  financeStatus: z.enum(["NOT_REQUIRED", "APPLIED", "APPROVED", "REJECTED", "DISBURSED"]).default("NOT_REQUIRED"),
  financier: z.string().trim().max(80).optional(),
  accessories: z.array(z.object({ name: z.string().trim().max(80), price: z.coerce.number().min(0) })).max(30).default([]),
});

export async function createBooking(actor: Actor, input: z.infer<typeof bookingInput>) {
  requirePermission(actor, "showroom.bookings.manage");
  assertBranch(actor, input.branchId, "Branch");
  if (input.discountAmount > 0 && !can(actor, "showroom.pricing.approve")) throw forbidden("Manual discounts need branch manager approval. Apply an approved coupon instead.");
  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: input.branchId }, include: { businessUnit: true } });
    let customerId = input.customerId;
    if (!customerId && input.leadId) {
      const lead = await tx.salesLead.findFirst({ where: { id: input.leadId, branchId: branch.id } });
      customerId = lead?.customerId ?? undefined;
      if (!customerId && lead) {
        const existing = await tx.customer.findFirst({ where: { phone: lead.phone } });
        customerId = existing?.id ?? (await createCustomerTx(tx, actor, branch.id, { fullName: lead.name, phone: lead.phone, email: lead.email ?? undefined })).id;
        await tx.salesLead.update({ where: { id: lead.id }, data: { customerId } });
      }
    }
    if (!customerId && input.newCustomer) customerId = (await createCustomerTx(tx, actor, branch.id, input.newCustomer)).id;
    if (!customerId) throw invalid("Select or create the customer.");

    let price = ZERO;
    if (input.vehicleId) {
      await tx.$queryRaw`SELECT 1 FROM "Vehicle" WHERE "id" = ${input.vehicleId}::uuid FOR UPDATE`;
      const v = await tx.vehicle.findFirst({ where: { id: input.vehicleId, branchId: branch.id } });
      if (!v) throw invalid("Vehicle not in this branch's stock.");
      if (v.status !== "AVAILABLE") throw conflict("This vehicle is no longer available.");
      if (v.vehicleModelId !== input.vehicleModelId) throw invalid("Vehicle does not match the selected model.");
      price = D(v.onRoadPrice);
      await tx.vehicle.update({ where: { id: v.id }, data: { status: "RESERVED" } });
    } else if (input.quotationId) {
      const q = await tx.salesQuotation.findFirst({ where: { id: input.quotationId, branchId: branch.id } });
      if (!q) throw invalid("Quotation not found.");
      price = D(q.totalAmount).plus(q.discountAmount);
    } else {
      throw invalid("Select a vehicle from stock or a quotation to price the booking.");
    }
    price = price.plus(sum(input.accessories.map((a) => a.price)));
    let discount = D(input.discountAmount);
    let couponId: string | null = null;
    if (input.couponCode) {
      const c = await validateCoupon(tx, input.couponCode, { businessUnitId: branch.businessUnitId, branchId: branch.id, appliesTo: "VEHICLE_SALE", orderValue: price, customerId });
      discount = discount.plus(c.discount);
      couponId = c.coupon.id;
    }
    if (discount.greaterThan(price)) throw invalid("Discount exceeds the price.");
    const booking = await tx.vehicleBooking.create({
      data: {
        bookingNumber: await nextNumber(tx, "BKG", branch.businessUnit.code),
        branchId: branch.id, customerId, vehicleModelId: input.vehicleModelId, vehicleId: input.vehicleId ?? null, quotationId: input.quotationId ?? null,
        salesExecutiveId: actor.userId, totalAmount: round2(price.minus(discount)), discountAmount: round2(discount),
        discountApprovedById: input.discountAmount > 0 ? actor.userId : null, couponId, financeStatus: input.financeStatus, financier: input.financier, accessories: input.accessories,
      },
    });
    if (couponId) {
      await tx.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } });
      await tx.couponRedemption.create({ data: { couponId, customerId, bookingId: booking.id, amount: discount.minus(input.discountAmount) } });
    }
    if (input.leadId) await tx.salesLead.updateMany({ where: { id: input.leadId }, data: { status: "BOOKED" } });
    await audit(tx, { actorId: actor.userId, action: "booking.create", entityType: "VehicleBooking", entityId: booking.id, branchId: branch.id, after: { total: booking.totalAmount, discount } });
    return booking;
  });
}

const BOOKING_FLOW: Record<string, string[]> = {
  RESERVED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["FINANCE_PENDING", "AWAITING_REGISTRATION", "ACCESSORIES_PENDING", "READY_FOR_DELIVERY", "CANCELLED"],
  FINANCE_PENDING: ["AWAITING_REGISTRATION", "ACCESSORIES_PENDING", "READY_FOR_DELIVERY", "CANCELLED"],
  AWAITING_REGISTRATION: ["ACCESSORIES_PENDING", "READY_FOR_DELIVERY", "CANCELLED"],
  ACCESSORIES_PENDING: ["AWAITING_REGISTRATION", "READY_FOR_DELIVERY", "CANCELLED"],
  READY_FOR_DELIVERY: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

const VEHICLE_FOR_BOOKING: Record<string, string> = {
  CONFIRMED: "BOOKING_CONFIRMED",
  FINANCE_PENDING: "BOOKING_CONFIRMED",
  AWAITING_REGISTRATION: "AWAITING_REGISTRATION",
  ACCESSORIES_PENDING: "ACCESSORIES_PENDING",
  READY_FOR_DELIVERY: "READY_FOR_DELIVERY",
};

export const bookingUpdateInput = z.object({
  status: z.enum(["CONFIRMED", "FINANCE_PENDING", "AWAITING_REGISTRATION", "ACCESSORIES_PENDING", "READY_FOR_DELIVERY", "CANCELLED"]).optional(),
  vehicleId: z.string().uuid().optional(),
  financeStatus: z.enum(["NOT_REQUIRED", "APPLIED", "APPROVED", "REJECTED", "DISBURSED"]).optional(),
  financier: z.string().trim().max(80).optional(),
  insuranceProvider: z.string().trim().max(80).optional(),
  insurancePolicyNumber: z.string().trim().max(40).optional(),
  registrationStatus: z.enum(["NOT_STARTED", "APPLIED", "COMPLETED"]).optional(),
  registrationNumber: z.string().trim().toUpperCase().max(15).optional(),
  deliveryScheduledAt: z.coerce.date().optional(),
  cancelReason: z.string().trim().max(300).optional(),
});

export async function updateBooking(actor: Actor, id: string, input: z.infer<typeof bookingUpdateInput>) {
  requirePermission(actor, "showroom.bookings.manage");
  const b = await prisma.vehicleBooking.findUnique({ where: { id } });
  if (!b) throw notFound("Booking");
  assertBranch(actor, b.branchId, "Booking");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "VehicleBooking" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const cur = await tx.vehicleBooking.findUniqueOrThrow({ where: { id } });
    if (input.status && input.status !== cur.status) {
      if (!BOOKING_FLOW[cur.status].includes(input.status)) throw rule(`Booking cannot move from ${cur.status} to ${input.status}.`);
      if (input.status === "CANCELLED" && !input.cancelReason) throw invalid("Record a cancellation reason.");
      if (input.status === "CONFIRMED") {
        const paid = await tx.payment.aggregate({ where: { bookingId: id, status: "CONFIRMED" }, _sum: { amount: true } });
        if (D(paid._sum.amount).lessThanOrEqualTo(0)) throw rule("Record and confirm a booking payment before confirming.");
      }
      if (input.status === "READY_FOR_DELIVERY" && !(input.vehicleId ?? cur.vehicleId)) throw rule("Allocate a vehicle before marking ready for delivery.");
    }
    let vehicleId = cur.vehicleId;
    if (input.vehicleId && input.vehicleId !== cur.vehicleId) {
      if (cur.vehicleId) throw rule("A vehicle is already allocated to this booking.");
      await tx.$queryRaw`SELECT 1 FROM "Vehicle" WHERE "id" = ${input.vehicleId}::uuid FOR UPDATE`;
      const v = await tx.vehicle.findFirst({ where: { id: input.vehicleId, branchId: cur.branchId, vehicleModelId: cur.vehicleModelId } });
      if (!v || v.status !== "AVAILABLE") throw conflict("That vehicle is not available for this booking.");
      vehicleId = v.id;
    }
    const { registrationNumber, ...rest } = input;
    const updated = await tx.vehicleBooking.update({ where: { id }, data: { ...rest, vehicleId } });
    if (vehicleId) {
      const vs = input.status === "CANCELLED" ? "AVAILABLE" : VEHICLE_FOR_BOOKING[updated.status] ?? "RESERVED";
      await tx.vehicle.update({
        where: { id: vehicleId },
        data: { status: vs as never, ...(input.registrationStatus ? { registrationStatus: input.registrationStatus === "COMPLETED" ? "REGISTERED" : input.registrationStatus === "APPLIED" ? "APPLIED" : "NOT_REGISTERED" } : {}), ...(registrationNumber ? { registrationNumber } : {}) },
      });
      if (input.status === "CANCELLED") await tx.vehicleBooking.update({ where: { id }, data: { vehicleId: null } });
    }
    await audit(tx, { actorId: actor.userId, action: "booking.update", entityType: "VehicleBooking", entityId: id, branchId: cur.branchId, before: { status: cur.status }, after: input });
    return updated;
  });
}

export const deliveryInput = z.object({
  checklist: z.object({ documentsHandedOver: z.boolean(), accessoriesFitted: z.boolean(), vehicleWalkaround: z.boolean(), ownersManual: z.boolean(), insuranceCopy: z.boolean() }),
  customerAcknowledged: z.literal(true, { errorMap: () => ({ message: "Customer acknowledgement is required." }) }),
});

/** Finalize the sale: requires pricing rights, full payment, completed checklist. Creates the customer's vehicle + warranty and a sale invoice. */
export async function deliverBooking(actor: Actor, id: string, input: z.infer<typeof deliveryInput>) {
  requirePermission(actor, "showroom.pricing.approve");
  const b = await prisma.vehicleBooking.findUnique({ where: { id } });
  if (!b) throw notFound("Booking");
  assertBranch(actor, b.branchId, "Booking");
  if (Object.values(input.checklist).some((v) => !v)) throw invalid("Complete every delivery checklist item.");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "VehicleBooking" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const cur = await tx.vehicleBooking.findUniqueOrThrow({ where: { id }, include: { vehicle: { include: { vehicleModel: true } }, branch: { include: { businessUnit: true } }, customer: true } });
    if (cur.status !== "READY_FOR_DELIVERY" || !cur.vehicle) throw rule("Booking must be ready for delivery with an allocated vehicle.");
    const paid = D((await tx.payment.aggregate({ where: { bookingId: id, status: "CONFIRMED" }, _sum: { amount: true } }))._sum.amount);
    if (paid.lessThan(cur.totalAmount)) throw rule(`Full payment is required before delivery (received ₹${paid.toFixed(2)} of ₹${D(cur.totalAmount).toFixed(2)}).`);
    const v = cur.vehicle;
    const now = new Date();

    // Sale invoice (tax-inclusive on-road price is split back into taxable value at the vehicle's GST rate).
    const gst = Number(await getBranchSetting(tx, cur.branchId, "vehicle.gstPercent"));
    // The ex-showroom price and the booking discount are both GST-inclusive. Split them back into
    // taxable value + tax so the vehicle line nets to exactly (ex-showroom − discount): the invoice
    // total then equals the booking total the customer agreed to and paid.
    const exIncl = D(v.exShowroomPrice);
    const discIncl = Prisma_min(D(cur.discountAmount), exIncl);
    const preTax = (x: Prisma.Decimal) => round2(x.times(100).dividedBy(100 + gst));
    const vehicleNet = exIncl.minus(discIncl);
    const vehicleTaxable = preTax(vehicleNet);
    const invoice = await tx.invoice.create({ data: { branchId: cur.branchId, kind: "VEHICLE_SALE", bookingId: id, customerId: cur.customerId, createdById: actor.userId, placeOfSupply: cur.branch.stateCode } });
    await tx.invoiceLineItem.create({
      data: {
        invoiceId: invoice.id, type: "VEHICLE", description: `${v.vehicleModel.name} ${v.vehicleModel.variant} (${v.colour}) — Chassis ${v.vin}`, hsnSac: "8711", quantity: 1,
        unitPrice: preTax(exIncl), discount: preTax(exIncl).minus(vehicleTaxable), taxRatePercent: gst, taxAmount: vehicleNet.minus(vehicleTaxable), lineTotal: vehicleNet,
      },
    });
    // Pass-through charges (insurance, RTO, accessories) are billed at cost without GST here.
    const others = [
      ...[["Insurance", v.insuranceCharges], ["Registration & RTO", v.registrationCharges], ["Accessories", v.accessoriesCharges], ["Fitting", v.fittingCharges], ["Other charges", v.otherCharges]]
        .filter(([, amt]) => D(amt as Prisma.Decimal).greaterThan(0))
        .map(([desc, amt]) => ({ description: desc as string, amount: D(amt as Prisma.Decimal) })),
      ...(cur.accessories as { name: string; price: number }[]).map((a) => ({ description: `Accessory: ${a.name}`, amount: D(a.price) })),
    ];
    for (const o of others) {
      await tx.invoiceLineItem.create({ data: { invoiceId: invoice.id, type: "OTHER", description: o.description, quantity: 1, unitPrice: o.amount, discount: 0, taxRatePercent: 0, taxAmount: 0, lineTotal: o.amount } });
    }
    await writeInvoiceTotals(tx, invoice.id, true);
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    const number = await nextNumber(tx, "INV", cur.branch.businessUnit.code);
    // Booking payments are applied to the sale invoice.
    const applied = Prisma_min(paid, inv.grandTotal);
    await tx.invoice.update({ where: { id: invoice.id }, data: { invoiceNumber: number, status: applied.greaterThanOrEqualTo(inv.grandTotal) ? "PAID" : "PARTIALLY_PAID", finalizedAt: now, finalizedById: actor.userId, amountPaid: applied, balanceDue: D(inv.grandTotal).minus(applied) } });

    await tx.vehicleBooking.update({ where: { id }, data: { status: "DELIVERED", deliveredAt: now, customerAcknowledgedAt: now, deliveryChecklist: input.checklist } });
    await tx.vehicle.update({ where: { id: v.id }, data: { status: "DELIVERED" } });
    const reg = v.registrationNumber ?? `TEMP${v.vin.slice(-8)}`;
    const cv = await tx.customerVehicle.create({
      data: { customerId: cur.customerId, vehicleModelId: v.vehicleModelId, modelName: `${v.vehicleModel.name} ${v.vehicleModel.variant}`.trim(), registrationNumber: reg, vin: v.vin, engineNumber: v.engineNumber, purchaseDate: now, lastOdometer: 0, soldVehicleId: v.id },
    });
    const months = Number(await getBranchSetting(tx, cur.branchId, "vehicle.warrantyMonths"));
    const end = new Date(now);
    end.setMonth(end.getMonth() + months);
    await tx.warranty.create({ data: { type: "VEHICLE", vehicleId: v.id, customerVehicleId: cv.id, startDate: now, endDate: end, terms: `${months}-month manufacturer warranty` } });
    await audit(tx, { actorId: actor.userId, action: "booking.deliver", entityType: "VehicleBooking", entityId: id, branchId: cur.branchId, after: { invoiceNumber: number, vin: v.vin } });
    return { invoiceId: invoice.id, invoiceNumber: number };
  });
}

function Prisma_min(a: Prisma.Decimal.Value, b: Prisma.Decimal.Value) {
  return D(a).lessThan(D(b)) ? D(a) : D(b);
}

export async function listBookings(actor: Actor, q: { branchId?: string; status?: string }) {
  requirePermission(actor, "showroom.view");
  return prisma.vehicleBooking.findMany({
    where: { ...branchFilter(actor, q.branchId), ...(q.status ? { status: q.status as never } : {}) },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { customer: { select: { fullName: true, phone: true } }, vehicleModel: true, vehicle: { select: { vin: true, colour: true } }, branch: { select: { name: true } } },
  });
}

export async function getBooking(actor: Actor, id: string) {
  const b = await prisma.vehicleBooking.findUnique({
    where: { id },
    include: { customer: true, vehicleModel: true, vehicle: true, branch: true, payments: { orderBy: { createdAt: "asc" } }, invoices: true, coupon: true, quotation: true },
  });
  if (!b) throw notFound("Booking");
  if (actor.kind === "CUSTOMER") {
    if (b.customerId !== actor.customerId) throw notFound("Booking");
    return { ...b, vehicle: b.vehicle ? { ...b.vehicle, purchaseCost: null } : null };
  }
  requirePermission(actor, "showroom.view");
  assertBranch(actor, b.branchId, "Booking");
  return can(actor, "vehicles.cost.view") ? b : { ...b, vehicle: b.vehicle ? { ...b.vehicle, purchaseCost: null } : null };
}
