import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { assertBranch, requirePermission } from "@/lib/rbac/actor";
import { audit } from "@/lib/audit";
import { invalid } from "@/lib/errors";

const body = z.object({
  businessUnitId: z.string().uuid(),
  branchId: z.string().uuid().nullable().default(null),
  vehicleModelId: z.string().uuid().nullable().default(null),
  taskKey: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{3,40}$/),
  label: z.string().trim().min(3).max(80),
  minMinutes: z.coerce.number().int().min(1),
  maxMinutes: z.coerce.number().int().min(1),
  defaultLabour: z.coerce.number().min(0).default(0),
});

/** Managers configure durations by branch/model; unit-wide defaults need group scope. */
export const PUT = api({ body }, async ({ actor, body }) => {
  requirePermission(actor, "settings.durations");
  if (body.branchId) assertBranch(actor, body.branchId, "Branch");
  else if (!actor.allBranches) throw invalid("Choose a branch for this duration.");
  if (body.maxMinutes < body.minMinutes) throw invalid("Maximum must be at least the minimum.");
  const existing = await prisma.repairDurationStandard.findFirst({ where: { businessUnitId: body.businessUnitId, branchId: body.branchId, vehicleModelId: body.vehicleModelId, taskKey: body.taskKey } });
  const row = existing
    ? await prisma.repairDurationStandard.update({ where: { id: existing.id }, data: body })
    : await prisma.repairDurationStandard.create({ data: body });
  await audit(prisma, { actorId: actor.userId, action: "settings.duration.upsert", entityType: "RepairDurationStandard", entityId: row.id, branchId: body.branchId, after: body });
  return row;
});
