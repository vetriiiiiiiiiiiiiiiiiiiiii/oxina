import { requireStaffPage } from "@/lib/auth/current";
import { can } from "@/lib/rbac/actor";
import { prisma } from "@/lib/db";
import { selectedBranchId } from "@/lib/branch-context";
import { listStock, reorderRecommendations, stockQuery } from "@/lib/services/inventory";
import { accessibleBranches } from "@/lib/services/org";
import { Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, Table, Td, Th } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { SimpleForm } from "@/components/forms/simple-form";
import { Pager } from "@/components/shell/tabs";
import { fmtMoney } from "@/lib/utils";
import { InventoryTabs } from "./nav";

export const metadata = { title: "Stock & Warehouse" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const actor = await requireStaffPage();
  const sp = await searchParams;
  const branchId = await selectedBranchId(actor);
  const q = stockQuery.parse({ ...sp, branchId });
  const [data, reorder, branches] = await Promise.all([listStock(actor, q), reorderRecommendations(actor, branchId), accessibleBranches(actor)]);
  const units = [...new Map(branches.map((b) => [b.businessUnitId, b.businessUnit.name])).entries()];
  const locations = await prisma.inventoryLocation.findMany({ where: { isActive: true, ...(branchId ? { branchId } : actor.allBranches ? {} : { branchId: { in: actor.branchIds } }) }, include: { branch: { select: { name: true } } }, orderBy: [{ branch: { name: "asc" } }, { code: "asc" }] });
  const items = await prisma.inventoryItem.findMany({ where: { isActive: true, businessUnitId: { in: units.map(([id]) => id) } }, orderBy: { name: "asc" }, select: { id: true, name: true, partNumber: true } });
  const showCost = can(actor, "inventory.cost.view");
  return (
    <>
      <PageHeader
       
        title="Stock"
        description="Available = on hand minus reserved for jobs."
        actions={can(actor, "inventory.manage") && (
          <>
            <Modal trigger="Adjust stock" title="Stock adjustment" description="Adjustments, damage, supplier returns and customer returns. A reason is required."><SimpleForm url="/api/inventory/adjust" successMessage="Stock updated." fields={[{ name: "itemId", label: "Item", type: "select", required: true, options: items.map((i) => ({ value: i.id, label: `${i.name} (${i.partNumber})` })) }, { name: "locationId", label: "Location", type: "select", required: true, options: locations.map((l) => ({ value: l.id, label: `${l.branch.name} · ${l.code}` })) }, { name: "type", label: "Type", type: "select", required: true, options: [["ADJUSTMENT_IN", "Adjustment in"], ["ADJUSTMENT_OUT", "Adjustment out"], ["DAMAGED", "Damaged (write-off)"], ["RETURN_TO_SUPPLIER", "Return to supplier"], ["CUSTOMER_RETURN", "Customer return"]].map(([value, label]) => ({ value, label })) }, { name: "quantity", label: "Quantity", type: "number", required: true, min: 1 }, { name: "batchNumber", label: "Batch / serial" }, { name: "reason", label: "Reason", type: "textarea", required: true }]} /></Modal>
            <Modal trigger="New item" title="New inventory item" triggerProps={{ variant: "primary" }} wide><SimpleForm url="/api/inventory/items" successMessage="Item created." fields={[{ name: "businessUnitId", label: "Business", type: "select", required: true, options: units.map(([value, label]) => ({ value, label })) }, { name: "partNumber", label: "Part number", required: true }, { name: "name", label: "Name", required: true }, { name: "category", label: "Category", type: "select", required: true, options: [["SPARE_PART", "Spare part"], ["ACCESSORY", "Accessory"], ["CONSUMABLE", "Consumable"], ["WARRANTY_REPLACEMENT", "Warranty replacement"]].map(([value, label]) => ({ value, label })) }, { name: "manufacturer", label: "Manufacturer" }, { name: "unit", label: "Unit", defaultValue: "pcs" }, { name: "purchaseCost", label: "Purchase cost (₹)", type: "number", required: true, step: "0.01" }, { name: "sellingPrice", label: "Selling price (₹)", type: "number", required: true, step: "0.01" }, { name: "taxRatePercent", label: "GST %", type: "number", defaultValue: 18 }, { name: "hsnCode", label: "HSN code" }, { name: "warrantyMonths", label: "Warranty (months)", type: "number" }, { name: "compatibleModels", label: "Compatible models", type: "list", hint: "Comma separated" }, { name: "description", label: "Description", type: "textarea" }]} /></Modal>
          </>
        )}
      />
      <InventoryTabs active="stock" />
      {reorder.length > 0 && (
        <Card className="mb-6">
          <CardHeader title={`Running low (${reorder.length})`} description="Suggested order = minimum + reorder qty − available − already on order, plus anything jobs are waiting for." />
          <Table><thead><tr><Th>Part</Th><Th>Branch</Th><Th className="text-right">Available</Th><Th className="text-right">Min</Th><Th className="text-right">On order</Th><Th className="text-right">Jobs waiting</Th><Th className="text-right">Recommend</Th><Th>Supplier</Th></tr></thead>
            <tbody>{reorder.slice(0, 12).map((r) => <tr key={r.itemId + r.branchId}><Td>{r.name}<div className="text-xs text-muted">{r.partNumber}</div></Td><Td className="text-xs">{r.branch}</Td><Td className="text-right">{r.available}</Td><Td className="text-right">{r.min}</Td><Td className="text-right">{r.onOrder}</Td><Td className="text-right">{r.waitingForJobs}</Td><Td className="text-right font-semibold">{r.recommendedQty}</Td><Td className="text-xs">{r.supplier ?? "—"}</Td></tr>)}</tbody>
          </Table>
        </Card>
      )}
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="search" defaultValue={q.search} placeholder="Part number or name" className="max-w-xs" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="lowOnly" value="true" defaultChecked={!!q.lowOnly} className="accent-brand-600" /> Low stock only</label>
        <Button variant="outline" type="submit">Filter</Button>
      </form>
      <Card>
        {data.rows.length ? (
          <Table>
            <thead><tr><Th>Part</Th><Th>Location</Th><Th className="text-right">On hand</Th><Th className="text-right">Reserved</Th><Th className="text-right">Available</Th><Th className="text-right">Min</Th><Th className="text-right">Price</Th>{showCost && <Th className="text-right">Cost</Th>}<Th /></tr></thead>
            <tbody>{data.rows.map((r) => (
              <tr key={r.id} className="hover:bg-canvas/60">
                <Td><span className="font-medium">{r.item.name}</span><div className="text-xs text-muted">{r.item.partNumber} · {r.item.category.toLowerCase().replace("_", " ")}{r.item.compatibleModels.length ? ` · ${r.item.compatibleModels.slice(0, 2).join(", ")}${r.item.compatibleModels.length > 2 ? "…" : ""}` : ""}</div></Td>
                <Td className="text-xs">{r.branch.name}<div className="text-muted">{r.location.code}{r.binLocation ? ` · bin ${r.binLocation}` : ""}</div></Td>
                <Td className="text-right tabular-nums">{r.onHand}</Td>
                <Td className="text-right tabular-nums">{r.reserved}</Td>
                <Td className="text-right font-semibold tabular-nums">{r.available} {r.low && <Badge tone={r.available <= 0 ? "bad" : "warn"}>{r.available <= 0 ? "out" : "low"}</Badge>}</Td>
                <Td className="text-right tabular-nums">{r.minStockLevel}</Td>
                <Td className="text-right tabular-nums">{fmtMoney(r.item.sellingPrice)}</Td>
                {showCost && <Td className="text-right tabular-nums">{fmtMoney(r.item.purchaseCost)}</Td>}
                <Td>{can(actor, "inventory.manage") && <Modal trigger="Levels" title={`Stock levels — ${r.item.name}`}><SimpleForm url={`/api/inventory/balances/${r.id}`} method="PATCH" fields={[{ name: "minStockLevel", label: "Minimum stock", type: "number", required: true, defaultValue: r.minStockLevel }, { name: "reorderQuantity", label: "Reorder quantity", type: "number", required: true, defaultValue: r.reorderQuantity }, { name: "binLocation", label: "Bin location", defaultValue: r.binLocation ?? "" }]} /></Modal>}</Td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="No stock records" description="Receive goods or add items to start tracking stock." />}
        <Pager page={data.page} pageSize={data.pageSize} total={data.total} base={`/inventory?search=${q.search ?? ""}${q.lowOnly ? "&lowOnly=true" : ""}`} />
      </Card>
    </>
  );
}
