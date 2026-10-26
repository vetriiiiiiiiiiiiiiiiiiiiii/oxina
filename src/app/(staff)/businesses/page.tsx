import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/current";
import { can, requirePermission } from "@/lib/rbac/actor";
import { listBusinessUnits } from "@/lib/services/org";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { SimpleForm } from "@/components/forms/simple-form";
import { ActionButton } from "@/components/forms/action-button";

export const metadata = { title: "Businesses & Branches" };

const TZ = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London"];

export default async function BusinessesPage() {
  const actor = await requireStaffPage();
  requirePermission(actor, "org.view");
  const units = await listBusinessUnits(actor);
  const manage = can(actor, "org.manage");
  return (
    <>
      <PageHeader title="Businesses & branches" 
        actions={manage && (
          <>
            <Modal trigger="New business unit" title="New business unit"><SimpleForm url="/api/businesses" fields={[{ name: "name", label: "Name", required: true }, { name: "code", label: "Code", required: true, hint: "2–8 letters, used in document numbers" }, { name: "type", label: "Type", type: "select", required: true, options: [["AUTOMOTIVE_DEALERSHIP", "Automotive dealership"], ["HOTEL", "Hotel"], ["RESTAURANT", "Restaurant"], ["OTHER", "Other"]].map(([value, label]) => ({ value, label })) }, { name: "brand", label: "Brand" }]} /></Modal>
            <Modal trigger="New branch" title="New branch" triggerProps={{ variant: "primary" }} wide><SimpleForm url="/api/branches" redirectPattern="/businesses/branches/{id}" successMessage="Branch created with default stock locations and departments." fields={[{ name: "businessUnitId", label: "Business unit", type: "select", required: true, options: units.filter((u) => u.isActive).map((u) => ({ value: u.id, label: u.name })) }, { name: "name", label: "Branch name", required: true }, { name: "code", label: "Branch code", required: true, placeholder: "RE-MDU-01" }, { name: "city", label: "City" }, { name: "state", label: "State" }, { name: "stateCode", label: "GST state code" }, { name: "phone", label: "Phone" }, { name: "email", label: "Email", type: "email" }, { name: "gstin", label: "GSTIN" }, { name: "timezone", label: "Time zone", type: "select", options: TZ.map((t) => ({ value: t, label: t })), defaultValue: "Asia/Kolkata" }, { name: "workdayStart", label: "Workday start", defaultValue: "09:30" }, { name: "workdayEnd", label: "Workday end", defaultValue: "18:30" }, { name: "serviceBays", label: "Service bays", type: "number", defaultValue: 4 }, { name: "addressLine", label: "Address", type: "textarea" }]} /></Modal>
          </>
        )} />
      <div className="space-y-6">
        {units.length ? units.map((u) => (
          <Card key={u.id}>
            <CardHeader title={<span className="flex items-center gap-2">{u.name} <Badge>{u.code}</Badge>{!u.isActive && <Badge tone="bad">inactive</Badge>}</span>} description={u.type.toLowerCase().replace("_", " ")} action={manage && <ActionButton size="sm" variant="ghost" url={`/api/businesses/${u.id}`} method="PATCH" body={{ isActive: !u.isActive }} confirm={u.isActive ? "Deactivate this business unit? History is preserved." : undefined} success="Updated.">{u.isActive ? "Deactivate" : "Reactivate"}</ActionButton>} />
            {u.branches.length ? (
              <Table>
                <thead><tr><Th>Branch</Th><Th>Code</Th><Th>City</Th><Th>Hours</Th><Th>Status</Th><Th /></tr></thead>
                <tbody>{u.branches.map((b) => (
                  <tr key={b.id}>
                    <Td><Link href={`/businesses/branches/${b.id}`} className="font-medium text-brand-700 hover:underline">{b.name}</Link></Td>
                    <Td className="font-mono text-xs">{b.code}</Td>
                    <Td className="text-xs">{b.city ?? "—"}</Td>
                    <Td className="text-xs">{b.workdayStart}–{b.workdayEnd} · {b.timezone}</Td>
                    <Td>{b.isActive ? <Badge tone="ok">active</Badge> : <Badge tone="bad">inactive</Badge>}</Td>
                    <Td>{manage && <ActionButton size="sm" variant="ghost" url={`/api/branches/${b.id}`} method="PATCH" body={{ isActive: !b.isActive }} confirm={b.isActive ? "Deactivate this branch? Records are preserved; no new work can be created." : undefined} success="Updated.">{b.isActive ? "Deactivate" : "Reactivate"}</ActionButton>}</Td>
                  </tr>
                ))}</tbody>
              </Table>
            ) : <EmptyState title="No branches yet" />}
          </Card>
        )) : <Card><EmptyState title="No business units" /></Card>}
      </div>
    </>
  );
}
