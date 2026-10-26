import type { Prisma } from "@prisma/client";
import type { Db } from "@/lib/db";

/** Branch-level operational policies with their defaults. */
export const BRANCH_SETTING_DEFAULTS = {
  "service.discountApprovalLimitPercent": 10,
  "service.approvalWaitMinutes": { min: 30, max: 240 },
  "service.allowDeliveryWithBalance": false,
  "billing.allowPartialPayments": true,
  "billing.labourSac": "998714",
  "billing.labourTaxPercent": 18,
  "followup.serviceReminderDays": 180,
  "attendance.graceMinutes": 10,
  "vehicle.warrantyMonths": 36,
  // GST (incl. any cess) embedded in the ex-showroom price. Validate per model/engine size before production.
  "vehicle.gstPercent": 28,
} as const;

export type BranchSettingKey = keyof typeof BRANCH_SETTING_DEFAULTS;

export async function getBranchSetting<K extends BranchSettingKey>(
  db: Db,
  branchId: string,
  key: K,
): Promise<(typeof BRANCH_SETTING_DEFAULTS)[K]> {
  const b = await db.branchSetting.findUnique({ where: { branchId_key: { branchId, key } } });
  if (b) return b.value as never;
  const branch = await db.branch.findUnique({ where: { id: branchId }, select: { businessUnitId: true } });
  if (branch) {
    const u = await db.businessSetting.findUnique({ where: { businessUnitId_key: { businessUnitId: branch.businessUnitId, key } } });
    if (u) return u.value as never;
  }
  return BRANCH_SETTING_DEFAULTS[key];
}

export async function setBranchSetting(db: Db, branchId: string, key: BranchSettingKey, value: Prisma.InputJsonValue) {
  await db.branchSetting.upsert({
    where: { branchId_key: { branchId, key } },
    create: { branchId, key, value },
    update: { value },
  });
}

/** Most specific duration standard: branch+model > branch > model > unit default. */
export async function getDuration(
  db: Db,
  q: { businessUnitId: string; branchId: string; vehicleModelId?: string | null; taskKey: string },
) {
  const rows = await db.repairDurationStandard.findMany({
    where: {
      businessUnitId: q.businessUnitId,
      taskKey: q.taskKey,
      OR: [{ branchId: q.branchId }, { branchId: null }],
    },
  });
  const score = (r: (typeof rows)[number]) =>
    (r.branchId ? 2 : 0) + (r.vehicleModelId && r.vehicleModelId === q.vehicleModelId ? 1 : r.vehicleModelId ? -10 : 0);
  const best = rows.filter((r) => score(r) >= 0).sort((a, b) => score(b) - score(a))[0];
  return best ?? null;
}
