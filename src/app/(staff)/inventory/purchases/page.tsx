import { requireStaffPage } from "@/lib/auth/current";
import { branchFilter, can } from "@/lib/rbac/actor";
import { prisma } from "@/lib/db";
import { selectedBranchId, workingBranchId } from "@/lib/branch-context";
import { accessibleBranches } from "@/lib/services/org";
import { Card, CardHeader, EmptyState, Notice, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { SimpleForm } from "@/components/forms/simple-form";
import { LinesForm } from "@/components/forms/lines-form";
import { ActionButton } from "@/components/forms/action-button";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/utils";
import { InventoryTabs } from "../nav";

export const metadata = { title: "Purchases" };

export default async function PurchasesPage() {
  const actor = await requireStaffPage();
  const branches = await accessibleBranches(actor);
  const branchId = await selectedBranchId(actor);
  const wb = await workingBranchId(actor, branches);
  const unitId = wb ? branches.find((b) => b.id === wb)!.businessUnitId : undefined;
  const [pos, grns, suppliers, items, locations] = await Promise.all([
    prisma.purchaseOrder.findMany({ where: branchFilter(actor, branchId), orderBy: { createdAt: "desc" }, take: 50, include: { supplier: { select: { name: true } }, branch: { select: { name: true } }, lines: { include: { item: { select: { name: true } } } } } }),
    prisma.goodsReceipt.findMany({ where: branchFilter(actor, branchId), orderBy: { receivedAt: "desc" }, take: 20, include: { supplier: { select: { name: true } }, lines: true, purchaseOrder: { select: { poNumber: true } } } }),
    prisma.supplier.findMany({ where: { isActive: true, ...(unitId ? { businessUnitId: unitId } : { businessUnitId: { in: [...new Set(branches.map((b) => b.businessUnitId))] } }) }, orderBy: { name: "asc" } }),
    unitId ? prisma.inventoryItem.findMany({ where: { businessUnitId: unitId, isActive: true }, orderBy: { name: "asc" } }) : [],
    wb ? prisma.inventoryLocation.findMany({ where: { branchId: wb, isActive: true } }) : [],
  ]);
  const itemOpts = items.map((i) => ({ value: i.id, label: `${i.name} (${i.partNumber})`, cost: Number(i.purchaseCost) }));
  const supOpts = suppliers.map((s) => ({ value: s.id, label: s.name }));
  return (
    <>
      <PageHeader title="Purchases & suppliers" description="A PO must be approved by someone other than the person who raised it. Received stock goes to waiting jobs first." actions={wb && can(actor, "purchases.manage") && (
        <>
          <Modal trigger="New supplier" title="New supplier"><SimpleForm url="/api/purchases/suppliers" fixed={{ businessUnitId: unitId }} fields={[{ name: "code", label: "Code", required: true }, { name: "name", label: "Name", required: true }, { name: "contactName", label: "Contact" }, { name: "phone", label: "Phone" }, { name: "email", label: "Email", type: "email" }, { name: "gstin", label: "GSTIN" }, { name: "leadTimeDays", label: "Lead time (days)", type: "number", defaultValue: 3 }, { name: "addressLine", label: "Address", type: "textarea" }]} /></Modal>
          <Modal trigger="Goods receipt" title="Record goods receipt (GRN)" wide><LinesForm url="/api/purchases/receipts" fixed={{ branchId: wb }} withCost items={itemOpts} submitLabel="Receive into stock" headerFields={[{ name: "supplierId", label: "Supplier", type: "select", required: true, options: supOpts }, { name: "locationId", label: "Receive into", type: "select", required: true, options: locations.map((l) => ({ value: l.id, label: `${l.code} — ${l.name}` })) }, { name: "purchaseOrderId", label: "Against PO (optional)", type: "select", options: pos.filter((p) => p.branchId === wb && ["APPROVED", "PARTIALLY_RECEIVED"].includes(p.status)).map((p) => ({ value: p.id, label: `${p.poNumber} — ${p.supplier.name}` })) }, { name: "supplierInvoice", label: "Supplier invoice no." }]} /></Modal>
          <Modal trigger="New purchase order" title="New purchase order" triggerProps={{ variant: "primary" }} wide><LinesForm url="/api/purchases/orders" fixed={{ branchId: wb }} withCost items={itemOpts} submitLabel="Create draft PO" headerFields={[{ name: "supplierId", label: "Supplier", type: "select", required: true, options: supOpts }, { name: "expectedDate", label: "Expected date", type: "date" }, { name: "notes", label: "Notes" }]} /></Modal>
        </>
      )} />
      <InventoryTabs active="purchases" />
      {!wb && <div className="mb-4"><Notice tone="warn">Select a branch in the header to create purchase orders or receipts.</Notice></div>}
      <Card className="mb-6">
        <CardHeader title="Purchase orders" />
        {pos.length ? (
          <Table>
            <thead><tr><Th>PO</Th><Th>Supplier</Th><Th>Items</Th><Th className="text-right">Total</Th><Th>Expected</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>{pos.map((p) => (
              <tr key={p.id}>
                <Td><span className="font-mono text-xs">{p.poNumber}</span><div className="text-xs text-muted">{p.branch.name}</div></Td>
                <Td>{p.supplier.name}</Td>
                <Td className="text-xs">{p.lines.map((l) => `${l.item.name} ×${l.quantity} (${l.receivedQuantity} rcvd)`).join("; ")}</Td>
                <Td className="text-right">{fmtMoney(p.totalAmount)}</Td>
                <Td className="text-xs">{fmtDate(p.expectedDate)}</Td>
                <Td><StatusBadge status={p.status} /></Td>
                <Td><div className="flex gap-2">
                  {p.status === "DRAFT" && can(actor, "purchases.manage") && <ActionButton size="sm" variant="outline" url={`/api/purchases/orders/${p.id}`} body={{ status: "SUBMITTED" }} success="Submitted for approval.">Submit</ActionButton>}
                  {p.status === "SUBMITTED" && can(actor, "purchases.approve") && <ActionButton size="sm" url={`/api/purchases/orders/${p.id}`} body={{ status: "APPROVED" }} success="Approved.">Approve</ActionButton>}
                  {["DRAFT", "SUBMITTED", "APPROVED"].includes(p.status) && can(actor, "purchases.manage") && <ActionButton size="sm" variant="ghost" url={`/api/purchases/orders/${p.id}`} body={{ status: "CANCELLED" }} confirm="Cancel this PO?" success="Cancelled.">Cancel</ActionButton>}
                </div></Td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="No purchase orders" />}
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Recent goods receipts" />{grns.length ? <ul className="divide-y divide-line text-sm">{grns.map((g) => <li key={g.id} className="px-5 py-3"><span className="font-mono text-xs">{g.grnNumber}</span> · {g.supplier.name}{g.purchaseOrder ? ` · ${g.purchaseOrder.poNumber}` : ""}<div className="text-xs text-muted">{fmtDateTime(g.receivedAt)} · {g.lines.length} line(s)</div></li>)}</ul> : <EmptyState title="No receipts yet" />}</Card>
        <Card><CardHeader title="Suppliers" />{suppliers.length ? <ul className="divide-y divide-line text-sm">{suppliers.map((s) => <li key={s.id} className="px-5 py-3">{s.name} <span className="text-xs text-muted">· {s.code} · lead time {s.leadTimeDays} d{s.phone ? ` · ${s.phone}` : ""}</span></li>)}</ul> : <EmptyState title="No suppliers" />}</Card>
      </div>
    </>
  );
}
