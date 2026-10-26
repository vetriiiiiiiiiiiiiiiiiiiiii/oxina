import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/current";
import { can } from "@/lib/rbac/actor";
import { selectedBranchId } from "@/lib/branch-context";
import { mechanicBoard } from "@/lib/services/service/repairs";
import { branchStaff } from "@/lib/services/org";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { fmtMinutes } from "@/lib/utils";
import { TaskActions } from "../[id]/actions";

export const metadata = { title: "Task board" };

const COLS = [["READY", "Ready"], ["IN_PROGRESS", "In progress"], ["PAUSED", "Paused"], ["BLOCKED", "Blocked"], ["PENDING", "Waiting"], ["COMPLETED", "Done (24 h)"]] as const;

export default async function BoardPage() {
  const actor = await requireStaffPage();
  const branchId = await selectedBranchId(actor);
  const tasks = await mechanicBoard(actor, branchId);
  const supervisor = can(actor, "service.repair.assign");
  const branchIds = [...new Set(tasks.map((t) => t.branchId))];
  const mechs = supervisor ? (await Promise.all(branchIds.map((b) => branchStaff(actor, b, ["MECHANIC"])))).flat() : [];
  const mechanics = [...new Map(mechs.map((m) => [m.id, { id: m.id, name: m.name, code: m.employee?.employeeCode ?? null }])).values()];
  return (
    <>
      <PageHeader title={supervisor ? "Mechanic task board" : "My tasks"} description="Pausing or blocking a task asks for a reason." />
      {tasks.length === 0 ? <Card><EmptyState title="No repair tasks" description="Assigned tasks show up here." /></Card> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {COLS.map(([k, label]) => {
            const col = tasks.filter((t) => t.status === k);
            return (
              <section key={k} className="min-w-0">
                <h2 className="mb-2 flex items-center justify-between border-b border-line-strong pb-1 text-[13px] font-semibold">{label}<span className="font-mono text-[12px] font-normal text-muted">{col.length}</span></h2>
                <div className="space-y-3">
                  {col.map((t) => (
                    <Card key={t.id} className="p-3">
                      <div className="flex flex-wrap gap-1">{t.isSafetyCritical && <Badge tone="bad">safety</Badge>}{t.job.isEmergency && <Badge tone="bad">emergency</Badge>}{t.reworkCount > 0 && <Badge tone="warn">rework</Badge>}</div>
                      <p className="mt-1 text-sm font-medium">{t.title}</p>
                      <Link href={`/service/${t.job.id}`} className="text-xs text-brand-700 hover:underline">{t.job.jobNumber}</Link>
                      <p className="text-xs text-muted">{t.job.customerVehicle.modelName} · {t.job.customerVehicle.registrationNumber}</p>
                      <p className="mt-1 text-xs text-muted">{t.assignedMechanic?.name ?? "Unassigned"} · {fmtMinutes(t.estimatedMinMinutes)}–{fmtMinutes(t.estimatedMaxMinutes)}</p>
                      {t.holdReason && <p className="mt-1 text-xs text-warn-700">{t.holdReason}</p>}
                      {t.partRequests.length > 0 && <p className="mt-1 text-[11px] text-muted">Parts: {t.partRequests.map((p) => `${p.item.name} (${p.status.toLowerCase().replace(/_/g, " ")})`).join(", ")}</p>}
                      {t.status !== "COMPLETED" && <div className="mt-2"><TaskActions task={{ id: t.id, status: t.status, version: t.version, mechanicId: t.assignedMechanicId, holdReason: t.holdReason }} mechanics={mechanics} canAssign={supervisor} isMine={t.assignedMechanicId === actor.userId} canWork={can(actor, "service.repair.work")} /></div>}
                    </Card>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
