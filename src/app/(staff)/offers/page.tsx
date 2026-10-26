import { requireStaffPage } from "@/lib/auth/current";
import { can, requirePermission } from "@/lib/rbac/actor";
import { workingBranchId } from "@/lib/branch-context";
import { accessibleBranches } from "@/lib/services/org";
import { listOffers } from "@/lib/services/misc";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { SimpleForm } from "@/components/forms/simple-form";
import { ActionButton } from "@/components/forms/action-button";
import { fmtDate, fmtMoney } from "@/lib/utils";

export const metadata = { title: "Offers & Coupons" };

export default async function OffersPage() {
  const actor = await requireStaffPage();
  requirePermission(actor, "offers.view");
  const branches = await accessibleBranches(actor);
  const wb = await workingBranchId(actor, branches);
  const offers = await listOffers(actor);
  const branch = branches.find((b) => b.id === wb);
  const now = new Date();
  return (
    <>
      <PageHeader title="Offers & coupons" description="Coupon codes can be applied at booking without a manager approving the discount."
        actions={branch && can(actor, "offers.manage") && <Modal trigger="New offer" title={`New offer — ${branch.name}`} triggerProps={{ variant: "primary" }} wide><SimpleForm url="/api/offers" fixed={{ businessUnitId: branch.businessUnitId, branchId: branch.id }} transform={undefined} fields={[{ name: "name", label: "Name", required: true }, { name: "appliesTo", label: "Applies to", type: "select", required: true, options: [["VEHICLE_SALE", "Vehicle sale"], ["SERVICE", "Service"], ["PARTS", "Parts"]].map(([value, label]) => ({ value, label })) }, { name: "discountType", label: "Discount type", type: "select", required: true, options: [{ value: "FLAT", label: "Flat ₹" }, { value: "PERCENT", label: "Percent" }] }, { name: "discountValue", label: "Value", type: "number", required: true }, { name: "maxDiscount", label: "Max discount (₹)", type: "number" }, { name: "minOrderValue", label: "Minimum order (₹)", type: "number" }, { name: "startsAt", label: "Starts", type: "datetime-local", required: true }, { name: "endsAt", label: "Ends", type: "datetime-local", required: true }, { name: "coupons.0.code", label: "Coupon code", hint: "Optional, e.g. DIWALI2026" }, { name: "coupons.0.usageLimit", label: "Total usage limit", type: "number" }, { name: "description", label: "Description / eligibility", type: "textarea" }]} /></Modal>} />
      <Card>
        {offers.length ? (
          <Table>
            <thead><tr><Th>Offer</Th><Th>Scope</Th><Th>Discount</Th><Th>Valid</Th><Th>Coupons</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>{offers.map((o) => {
              const live = o.isActive && o.startsAt <= now && o.endsAt >= now;
              return (
                <tr key={o.id}>
                  <Td><span className="font-medium">{o.name}</span>{o.description && <div className="text-xs text-muted">{o.description}</div>}</Td>
                  <Td className="text-xs">{o.businessUnit.name}<div className="text-muted">{o.branch?.name ?? "All branches"} · {o.appliesTo.toLowerCase().replace("_", " ")}</div></Td>
                  <Td className="text-xs">{o.discountType === "PERCENT" ? `${Number(o.discountValue)}%` : fmtMoney(o.discountValue)}{o.maxDiscount ? ` (max ${fmtMoney(o.maxDiscount)})` : ""}</Td>
                  <Td className="text-xs">{fmtDate(o.startsAt)} – {fmtDate(o.endsAt)}</Td>
                  <Td className="text-xs">{o.coupons.map((c) => <div key={c.id} className="font-mono">{c.code} · {c.usedCount}/{c.usageLimit ?? "∞"}</div>)}</Td>
                  <Td>{live ? <Badge tone="ok">live</Badge> : o.isActive ? <Badge tone="warn">scheduled / ended</Badge> : <Badge>disabled</Badge>}</Td>
                  <Td>{can(actor, "offers.manage") && <ActionButton size="sm" variant="ghost" url={`/api/offers/${o.id}`} method="PATCH" body={{ isActive: !o.isActive }} success="Updated.">{o.isActive ? "Disable" : "Enable"}</ActionButton>}</Td>
                </tr>
              );
            })}</tbody>
          </Table>
        ) : <EmptyState title="No offers" />}
      </Card>
    </>
  );
}
