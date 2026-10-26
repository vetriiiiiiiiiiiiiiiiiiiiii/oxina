import { requireStaffPage } from "@/lib/auth/current";
import { can, hasBranch } from "@/lib/rbac/actor";
import { prisma } from "@/lib/db";
import { selectedBranchId, workingBranchId } from "@/lib/branch-context";
import { accessibleBranches } from "@/lib/services/org";
import { Card, EmptyState, Notice, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { LinesForm } from "@/components/forms/lines-form";
import { ActionButton } from "@/components/forms/action-button";
import { fmtDateTime } from "@/lib/utils";
import { InventoryTabs } from "../nav";

export const metadata = { title: "Stock transfers" };

export default async function TransfersPage() {
  const actor = await requireStaffPage();
  const branches = await accessibleBranches(actor);
  const sel = await selectedBranchId(actor);
  const wb = await workingBranchId(actor, branches);
  const ids = sel ? [sel] : actor.allBranches ? undefined : actor.branchIds;
  const transfers = await prisma.stockTransfer.findMany({
    where: ids ? { OR: [{ fromBranchId: { in: ids } }, { toBranchId: { in: ids } }] } : {},
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { fromBranch: { select: { name: true } }, toBranch: { select: { name: true } }, lines: { include: { item: { select: { name: true } } } } },
  });
  const unitId = wb ? branches.find((b) => b.id === wb)!.businessUnitId : undefined;
  const [locations, items] = unitId ? await Promise.all([
    prisma.inventoryLocation.findMany({ where: { isActive: true, branch: { businessUnitId: unitId, isActive: true } }, include: { branch: { select: { id: true, name: true } } }, orderBy: [{ branch: { name: "asc" } }] }),
    prisma.inventoryItem.findMany({ where: { businessUnitId: unitId, isActive: true }, orderBy: { name: "asc" } }),
  ]) : [[], []];
  return (
    <>
      <PageHeader title="Transfers between branches" description="Stock leaves the sending branch on dispatch and is added at the receiving branch when they confirm receipt." actions={wb && can(actor, "inventory.transfer") && (
        <Modal trigger="Request transfer" title="Request stock from another branch" triggerProps={{ variant: "primary" }} wide>
          <LinesForm url="/api/inventory/transfers" items={items.map((i) => ({ value: i.id, label: `${i.name} (${i.partNumber})` }))} submitLabel="Request transfer" headerFields={[{ name: "fromLocationId", label: "From", type: "select", required: true, options: locations.filter((l) => l.branch.id !== wb).map((l) => ({ value: l.id, label: `${l.branch.name} · ${l.code}` })) }, { name: "toLocationId", label: "To", type: "select", required: true, options: locations.filter((l) => l.branch.id === wb).map((l) => ({ value: l.id, label: `${l.branch.name} · ${l.code}` })) }, { name: "notes", label: "Notes" }]} />
        </Modal>
      )} />
      <InventoryTabs active="transfers" />
      {!wb && <div className="mb-4"><Notice tone="warn">Select a branch in the header to request a transfer into it.</Notice></div>}
      <Card>
        {transfers.length ? (
          <Table>
            <thead><tr><Th>Transfer</Th><Th>From → To</Th><Th>Items</Th><Th>Status</Th><Th>Timeline</Th><Th /></tr></thead>
            <tbody>{transfers.map((t) => {
              const src = hasBranch(actor, t.fromBranchId);
              const dst = hasBranch(actor, t.toBranchId);
              return (
                <tr key={t.id}>
                  <Td className="font-mono text-xs">{t.transferNumber}</Td>
                  <Td className="text-xs">{t.fromBranch.name} → {t.toBranch.name}</Td>
                  <Td className="text-xs">{t.lines.map((l) => `${l.item.name} ×${l.quantity}`).join("; ")}</Td>
                  <Td><StatusBadge status={t.status} /></Td>
                  <Td className="text-xs text-muted">Requested {fmtDateTime(t.createdAt)}{t.dispatchedAt ? <><br />Dispatched {fmtDateTime(t.dispatchedAt)}</> : null}{t.receivedAt ? <><br />Received {fmtDateTime(t.receivedAt)}</> : null}</Td>
                  <Td>{can(actor, "inventory.transfer") && <div className="flex flex-wrap gap-2">
                    {t.status === "REQUESTED" && src && <ActionButton size="sm" url={`/api/inventory/transfers/${t.id}`} body={{ action: "APPROVE" }} success="Approved.">Approve</ActionButton>}
                    {t.status === "APPROVED" && src && <ActionButton size="sm" url={`/api/inventory/transfers/${t.id}`} body={{ action: "DISPATCH" }} confirm="Dispatch now? Stock leaves the source location." success="Dispatched.">Dispatch</ActionButton>}
                    {t.status === "DISPATCHED" && dst && <ActionButton size="sm" variant="success" url={`/api/inventory/transfers/${t.id}`} body={{ action: "RECEIVE" }} success="Received into stock.">Confirm receipt</ActionButton>}
                    {["REQUESTED", "APPROVED"].includes(t.status) && <ActionButton size="sm" variant="ghost" url={`/api/inventory/transfers/${t.id}`} body={{ action: "CANCEL" }} confirm="Cancel this transfer?" success="Cancelled.">Cancel</ActionButton>}
                  </div>}</Td>
                </tr>
              );
            })}</tbody>
          </Table>
        ) : <EmptyState title="No transfers" />}
      </Card>
    </>
  );
}
