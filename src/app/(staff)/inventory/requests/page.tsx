import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/current";
import { can } from "@/lib/rbac/actor";
import { selectedBranchId } from "@/lib/branch-context";
import { listPartRequests } from "@/lib/services/service/parts";
import { branchStaff } from "@/lib/services/org";
import { Badge, Card, EmptyState, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { SimpleForm } from "@/components/forms/simple-form";
import { ActionButton } from "@/components/forms/action-button";
import { LinkTabs } from "@/components/shell/tabs";
import { fmtDateTime } from "@/lib/utils";
import { InventoryTabs } from "../nav";
import { ProcurementForm } from "../../service/[id]/actions";

export const metadata = { title: "Service part requests" };

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ view?: "queue" | "shortages" | "issued" | "all" }> }) {
  const actor = await requireStaffPage();
  const view = (await searchParams).view ?? "queue";
  const rows = await listPartRequests(actor, { branchId: await selectedBranchId(actor), view });
  const branchIds = [...new Set(rows.map((r) => r.branchId))];
  const mechByBranch = new Map(await Promise.all(branchIds.map(async (b) => [b, await branchStaff(actor, b, ["MECHANIC"])] as const)));
  return (
    <>
      <PageHeader title="Parts requests from the workshop" />
      <InventoryTabs active="requests" />
      <LinkTabs active={view} tabs={[{ key: "queue", label: "To pick & issue", href: "?view=queue" }, { key: "shortages", label: "Shortages", href: "?view=shortages" }, { key: "issued", label: "Issued", href: "?view=issued" }, { key: "all", label: "All", href: "?view=all" }]} />
      <Card>
        {rows.length ? (
          <Table>
            <thead><tr><Th>Request</Th><Th>Part</Th><Th className="text-right">Qty</Th><Th>Job / task</Th><Th>Status</Th><Th>Mechanic</Th><Th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <Td><span className="font-mono text-xs">{r.requestNumber}</span><div className="text-xs text-muted">{fmtDateTime(r.createdAt)} · {r.requestedBy.name}</div>{r.priority !== "NORMAL" && <Badge tone="bad">{r.priority.toLowerCase()}</Badge>}</Td>
                <Td>{r.item.name}<div className="text-xs text-muted">{r.item.partNumber} · {r.location.code} · {r.branch.name}</div></Td>
                <Td className="text-right tabular-nums">{r.quantity}</Td>
                <Td className="text-xs"><Link className="text-brand-700 hover:underline" href={`/service/${r.job.id}`}>{r.job.jobNumber}</Link><div className="text-muted">{r.job.customerVehicle.registrationNumber}{r.repairTask ? ` · ${r.repairTask.title}` : ""}</div></Td>
                <Td><StatusBadge status={r.status} />{r.expectedAvailableAt && <div className="text-xs text-muted">ETA {fmtDateTime(r.expectedAvailableAt)}</div>}{r.issue && <div className="text-xs text-muted">{r.issue.issuedBy.name} → {r.issue.receivedBy.name}</div>}</Td>
                <Td className="text-xs">{r.assignedMechanic?.name ?? "—"}</Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    {can(actor, "inventory.issue") && r.status === "RESERVED" && <ActionButton size="sm" variant="outline" url={`/api/inventory/requests/${r.id}/pick`} body={{ to: "PICKING" }} success="Picking started.">Start picking</ActionButton>}
                    {can(actor, "inventory.issue") && r.status === "PICKING" && <ActionButton size="sm" variant="outline" url={`/api/inventory/requests/${r.id}/pick`} body={{ to: "PICKED" }} success="Marked picked.">Picked</ActionButton>}
                    {can(actor, "inventory.issue") && ["RESERVED", "PICKING", "PICKED"].includes(r.status) && (
                      <Modal trigger="Issue" title={`Issue ${r.item.name} × ${r.quantity}`} triggerProps={{ variant: "primary" }}>
                        <SimpleForm url={`/api/inventory/requests/${r.id}/issue`} columns={1} submitLabel="Issue part" successMessage="Part issued and recorded." fields={[{ name: "receivedByMechanicId", label: "Receiving mechanic", type: "select", required: true, defaultValue: r.assignedMechanic?.id ?? "", options: (mechByBranch.get(r.branchId) ?? []).map((m) => ({ value: m.id, label: `${m.name}${m.employee ? ` (${m.employee.employeeCode})` : ""}` })) }]} />
                      </Modal>
                    )}
                    {["UNAVAILABLE", "AWAITING_PROCUREMENT"].includes(r.status) && (can(actor, "inventory.manage") || can(actor, "service.job.manage")) && <ProcurementForm requestId={r.id} />}
                  </div>
                </Td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="Nothing here" description={view === "queue" ? "No parts waiting to be picked." : undefined} />}
      </Card>
    </>
  );
}
