import { z } from "zod";
import { api } from "@/lib/api";
import { prisma } from "@/lib/db";
import { assertBranch, requirePermission } from "@/lib/rbac/actor";
import { BRANCH_SETTING_DEFAULTS, setBranchSetting, type BranchSettingKey } from "@/lib/services/settings";
import { audit } from "@/lib/audit";
import { invalid } from "@/lib/errors";

const body = z.object({ key: z.string(), value: z.union([z.number(), z.boolean(), z.string(), z.object({ min: z.number().int().min(0), max: z.number().int().min(0) })]) });

export const PUT = api({ body }, async ({ actor, body, params }) => {
  requirePermission(actor, "settings.manage");
  assertBranch(actor, params.id, "Branch");
  if (!(body.key in BRANCH_SETTING_DEFAULTS)) throw invalid("Unknown setting.");
  const def = BRANCH_SETTING_DEFAULTS[body.key as BranchSettingKey];
  if (typeof def !== typeof body.value) throw invalid("Wrong value type for this setting.");
  await setBranchSetting(prisma, params.id, body.key as BranchSettingKey, body.value);
  await audit(prisma, { actorId: actor.userId, action: "settings.branch.update", entityType: "BranchSetting", entityId: body.key, branchId: params.id, after: body });
  return { ok: true };
});
