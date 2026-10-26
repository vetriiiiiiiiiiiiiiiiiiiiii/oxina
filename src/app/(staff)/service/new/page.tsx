import { requireStaffPage } from "@/lib/auth/current";
import { requirePermission } from "@/lib/rbac/actor";
import { prisma } from "@/lib/db";
import { accessibleBranches, branchStaff } from "@/lib/services/org";
import { workingBranchId } from "@/lib/branch-context";
import { Notice, PageHeader } from "@/components/ui";
import { IntakeForm } from "./intake-form";

export const metadata = { title: "New job card" };

export default async function NewJobPage() {
  const actor = await requireStaffPage();
  requirePermission(actor, "service.job.create");
  const branches = await accessibleBranches(actor);
  const branchId = await workingBranchId(actor, branches);
  if (!branchId) {
    return (<><PageHeader title="New job card" /><Notice tone="warn">Choose a branch in the header selector first — a job card belongs to exactly one branch.</Notice></>);
  }
  const branch = branches.find((b) => b.id === branchId)!;
  const [models, advisors] = await Promise.all([
    prisma.vehicleModel.findMany({ where: { businessUnitId: branch.businessUnitId, isActive: true }, orderBy: [{ name: "asc" }, { variant: "asc" }], select: { id: true, name: true, variant: true } }),
    branchStaff(actor, branchId, ["SERVICE_ADVISOR", "BRANCH_MANAGER"]),
  ]);
  return (
    <>
      <PageHeader eyebrow={branch.name} title="Vehicle reception" description="Create the digital job card. The customer can follow progress in their portal." />
      <IntakeForm branchId={branchId} models={models} advisors={advisors.map((a) => ({ id: a.id, name: a.name }))} me={actor.userId} />
    </>
  );
}
