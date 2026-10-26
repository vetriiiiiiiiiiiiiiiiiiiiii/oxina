import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac/actor";
import { phoneSchema } from "@/lib/services/customers";
import { rateLimit } from "@/lib/auth/rate-limit";

/** Exact-phone lookup at the counter. Returns minimal fields; rate limited per user. */
export const GET = api({ query: z.object({ phone: phoneSchema }) }, async ({ actor, query }) => {
  requirePermission(actor, "service.job.create", "showroom.bookings.manage");
  await rateLimit(`lookup:${actor.userId}`, 60, 60 * 60_000);
  const c = await prisma.customer.findFirst({ where: { phone: query.phone, isActive: true }, select: { id: true, fullName: true, email: true, vehicles: { select: { registrationNumber: true, modelName: true, vehicleModelId: true } } } });
  return c;
});
