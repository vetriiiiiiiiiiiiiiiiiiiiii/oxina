import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/current";
import { can } from "@/lib/rbac/actor";
import { prisma } from "@/lib/db";
import { selectedBranchId } from "@/lib/branch-context";
import { stockMovements } from "@/lib/services/inventory";
import { Card, CardHeader, EmptyState, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { ActionButton } from "@/components/forms/action-button";
import { fmtDateTime } from "@/lib/utils";
import { InventoryTabs } from "../nav";
import { AuditCount } from "./audit-count";

export const metadata = { title: "Stock movements" };

export default async function MovementsPage() {
  const actor = await requireStaffPage();
  const branchId = await selectedBranchId(actor);
  const rows = await stockMovements(actor, { branchId });
  const locWhere = branchId ? { branchId } : actor.allBranches ? {} : { branchId: { in: actor.branchIds } };
  const [audits, locations] = await Promise.all([
    prisma.stockAudit.findMany({ where: locWhere, orderBy: { startedAt: "desc" }, take: 10, include: { location: { include: { branch: { select: { name: true } }, balances: { include: { item: { select: { id: true, name: true, partNumber: true } } } } } }, lines: true } }),
    prisma.inventoryLocation.findMany({ where: { ...locWhere, isActive: true }, include: { branch: { select: { name: true } } } }),
  ]);
  return (
    <>
      <PageHeader title="Movements & stock counts" />
      <InventoryTabs active="movements" />
      <Card className="mb-6">
        <CardHeader title="Stock counts" description="Differences from the count are posted as adjustments." action={can(actor, "inventory.manage") && <div className="flex flex-wrap gap-2">{locations.map((l) => <ActionButton key={l.id} size="sm" variant="outline" url="/api/inventory/audits" body={{ locationId: l.id }} success="Audit started.">Audit {l.branch.name.replace(/^.*—\s*/, "")} · {l.code}</ActionButton>)}</div>} />
        {audits.length ? <ul className="divide-y divide-line">{audits.map((a) => (
          <li key={a.id} className="space-y-2 px-5 py-3 text-sm">
            <div className="flex items-center gap-2">{a.location.branch.name} · {a.location.code} <StatusBadge status={a.status === "IN_PROGRESS" ? "IN_PROGRESS" : "COMPLETED"} /> <span className="text-xs text-muted">{fmtDateTime(a.startedAt)}</span>{a.status === "COMPLETED" && <span className="text-xs text-muted">· {a.lines.filter((l) => l.countedQty !== l.systemQty).length} variance(s)</span>}</div>
            {a.status === "IN_PROGRESS" && can(actor, "inventory.manage") && <AuditCount auditId={a.id} items={a.location.balances.map((b) => ({ id: b.item.id, label: `${b.item.name} (${b.item.partNumber})`, system: b.quantityOnHand }))} />}
          </li>
        ))}</ul> : <EmptyState title="No audits yet" />}
      </Card>
      <Card>
        <CardHeader title="Latest movements" />
        {rows.length ? (
          <Table>
            <thead><tr><Th>When</Th><Th>Item</Th><Th>Type</Th><Th className="text-right">Δ on hand</Th><Th className="text-right">Δ reserved</Th><Th className="text-right">After</Th><Th>Reference</Th><Th>By</Th></tr></thead>
            <tbody>{rows.map((m) => (
              <tr key={m.id}>
                <Td className="whitespace-nowrap text-xs">{fmtDateTime(m.createdAt)}</Td>
                <Td>{m.item.name}<div className="text-xs text-muted">{m.item.partNumber} · {m.location.code}</div></Td>
                <Td className="text-xs">{m.type.toLowerCase().replace(/_/g, " ")}</Td>
                <Td className={`text-right tabular-nums ${m.quantityDelta < 0 ? "text-bad-700" : m.quantityDelta > 0 ? "text-ok-700" : ""}`}>{m.quantityDelta > 0 ? "+" : ""}{m.quantityDelta}</Td>
                <Td className="text-right tabular-nums">{m.reservedDelta > 0 ? "+" : ""}{m.reservedDelta}</Td>
                <Td className="text-right text-xs tabular-nums">{m.onHandAfter} / {m.reservedAfter}</Td>
                <Td className="text-xs">{m.serviceJob ? <Link className="text-brand-700" href={`/service/${m.serviceJob.id}`}>{m.serviceJob.jobNumber}</Link> : m.referenceType ?? "—"}{m.reason && <div className="text-muted">{m.reason}</div>}</Td>
                <Td className="text-xs">{m.performedBy.name}</Td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="No movements" />}
      </Card>
    </>
  );
}
