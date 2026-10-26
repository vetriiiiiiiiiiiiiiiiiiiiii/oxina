import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/current";
import { can, requirePermission } from "@/lib/rbac/actor";
import { selectedBranchId, workingBranchId } from "@/lib/branch-context";
import { accessibleBranches } from "@/lib/services/org";
import { listClaims, listWarranties } from "@/lib/services/misc";
import { Card, CardHeader, EmptyState, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { SimpleForm } from "@/components/forms/simple-form";
import { LinkTabs } from "@/components/shell/tabs";
import { fmtDate, fmtMoney } from "@/lib/utils";

export const metadata = { title: "Warranty & Claims" };

const NEXT: Record<string, string[]> = { DRAFT: ["SUBMITTED"], SUBMITTED: ["UNDER_REVIEW", "APPROVED", "REJECTED"], UNDER_REVIEW: ["APPROVED", "REJECTED"], APPROVED: ["SETTLED"] };

export default async function WarrantyPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  const actor = await requireStaffPage();
  requirePermission(actor, "warranty.view");
  const sp = await searchParams;
  const tab = sp.tab ?? "claims";
  const branches = await accessibleBranches(actor);
  const wb = await workingBranchId(actor, branches);
  const branchId = await selectedBranchId(actor);
  return (
    <>
      <PageHeader title="Warranty & claims" description={actor.roles.includes("OEM_REPRESENTATIVE") ? "Claims for your brands." : undefined}
        actions={wb && can(actor, "warranty.manage") && <Modal trigger="New claim" title="New warranty claim" triggerProps={{ variant: "primary" }}><SimpleForm url="/api/warranty/claims" fixed={{ branchId: wb }} fields={[{ name: "manufacturer", label: "Manufacturer / supplier", required: true }, { name: "claimType", label: "Claim type", type: "select", required: true, options: [{ value: "VEHICLE", label: "Vehicle" }, { value: "PART", label: "Part" }] }, { name: "claimAmount", label: "Claim amount (₹)", type: "number", required: true }, { name: "description", label: "Description", type: "textarea", required: true }]} /></Modal>} />
      <LinkTabs active={tab} tabs={[{ key: "claims", label: "Claims", href: "?tab=claims" }, { key: "warranties", label: "Warranties", href: "?tab=warranties" }]} />
      {tab === "claims" ? <Claims /> : <Warranties />}
    </>
  );

  async function Claims() {
    const rows = await listClaims(actor, { branchId, status: sp.status });
    return (
      <Card>
        {rows.length ? (
          <Table>
            <thead><tr><Th>Claim</Th><Th>Manufacturer</Th><Th>Job</Th><Th className="text-right">Claimed</Th><Th className="text-right">Reimbursed</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id}>
                <Td><span className="font-mono text-xs">{c.claimNumber}</span><div className="text-xs text-muted">{c.branch.name} · {fmtDate(c.createdAt)}</div><div className="text-xs">{c.description}</div></Td>
                <Td className="text-xs">{c.manufacturer}<div className="text-muted">{c.claimType.toLowerCase()}</div></Td>
                <Td className="text-xs">{c.serviceJob ? <Link className="text-brand-700" href={`/service/${c.serviceJob.id}`}>{c.serviceJob.jobNumber}</Link> : "—"}</Td>
                <Td className="text-right">{fmtMoney(c.claimAmount)}</Td>
                <Td className="text-right">{c.reimbursedAmount ? fmtMoney(c.reimbursedAmount) : "—"}</Td>
                <Td><StatusBadge status={c.status} />{c.decisionReason && <div className="text-xs text-muted">{c.decisionReason}</div>}</Td>
                <Td>{can(actor, "warranty.manage") && NEXT[c.status] && <Modal trigger="Update" title={`Update ${c.claimNumber}`}><SimpleForm url={`/api/warranty/claims/${c.id}`} columns={1} fields={[{ name: "status", label: "Move to", type: "select", required: true, options: NEXT[c.status].map((s) => ({ value: s, label: s.toLowerCase().replace("_", " ") })) }, { name: "decisionReason", label: "Decision / reason", type: "textarea" }, { name: "reimbursedAmount", label: "Reimbursed amount (₹, when settling)", type: "number" }]} /></Modal>}</Td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="No claims" />}
      </Card>
    );
  }

  async function Warranties() {
    const rows = await listWarranties(actor, {});
    return (
      <Card>
        <CardHeader title="Active and past warranties" description="Created automatically at vehicle delivery and when warranted parts are issued." />
        {rows.length ? (
          <Table>
            <thead><tr><Th>Type</Th><Th>Vehicle</Th><Th>Item</Th><Th>From</Th><Th>Until</Th><Th>Status</Th></tr></thead>
            <tbody>{rows.map((w) => <tr key={w.id}><Td className="text-xs">{w.type.toLowerCase()}</Td><Td className="text-xs">{w.customerVehicle ? `${w.customerVehicle.modelName} · ${w.customerVehicle.registrationNumber}` : w.vehicle?.vin ?? "—"}</Td><Td className="text-xs">{w.inventoryItem ? `${w.inventoryItem.name} (${w.inventoryItem.partNumber})` : "—"}</Td><Td className="text-xs">{fmtDate(w.startDate)}</Td><Td className="text-xs">{fmtDate(w.endDate)}</Td><Td><StatusBadge status={w.endDate >= new Date() ? "ACTIVE" : "CLOSED"} label={w.endDate >= new Date() ? "active" : "expired"} /></Td></tr>)}</tbody>
          </Table>
        ) : <EmptyState title="No warranties recorded" />}
      </Card>
    );
  }
}
