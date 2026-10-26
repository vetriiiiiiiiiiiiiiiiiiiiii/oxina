import { requireStaffPage } from "@/lib/auth/current";
import { can } from "@/lib/rbac/actor";
import { prisma } from "@/lib/db";
import { selectedBranchId, workingBranchId } from "@/lib/branch-context";
import { accessibleBranches } from "@/lib/services/org";
import { listVehicles } from "@/lib/services/showroom";
import { Button, Card, EmptyState, Input, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { SimpleForm } from "@/components/forms/simple-form";
import { LinkTabs } from "@/components/shell/tabs";
import { fmtMoney } from "@/lib/utils";

export const metadata = { title: "Vehicle inventory" };

const STATUSES = ["AVAILABLE", "RESERVED", "BOOKING_CONFIRMED", "AWAITING_REGISTRATION", "ACCESSORIES_PENDING", "READY_FOR_DELIVERY", "DELIVERED", "TRANSFERRED", "RETURNED"];

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<{ status?: string; search?: string }> }) {
  const actor = await requireStaffPage();
  const sp = await searchParams;
  const branches = await accessibleBranches(actor);
  const branchId = await selectedBranchId(actor);
  const wb = await workingBranchId(actor, branches);
  const rows = await listVehicles(actor, { branchId, status: sp.status, search: sp.search });
  const models = wb ? await prisma.vehicleModel.findMany({ where: { businessUnitId: branches.find((b) => b.id === wb)!.businessUnitId, isActive: true }, orderBy: { name: "asc" } }) : [];
  const cost = can(actor, "vehicles.cost.view");
  const money = (n: string, l: string, req = false) => ({ name: n, label: l, type: "number" as const, required: req, step: "0.01" });
  return (
    <>
      <PageHeader title="Vehicles in stock"
        actions={wb && can(actor, "vehicles.manage") && <Modal trigger="Add vehicle" title="Receive vehicle into stock" triggerProps={{ variant: "primary" }} wide><SimpleForm url="/api/vehicles" fixed={{ branchId: wb }} successMessage="Vehicle added." fields={[{ name: "vehicleModelId", label: "Model", type: "select", required: true, options: models.map((m) => ({ value: m.id, label: `${m.name} ${m.variant}` })) }, { name: "modelYear", label: "Model year", type: "number", required: true, defaultValue: new Date().getFullYear() }, { name: "colour", label: "Colour", required: true }, { name: "vin", label: "Chassis / VIN", required: true }, { name: "engineNumber", label: "Engine number", required: true }, { name: "stockLocation", label: "Stock location" }, money("purchaseCost", "Purchase cost (₹)", true), money("exShowroomPrice", "Ex-showroom (₹)", true), money("insuranceCharges", "Insurance (₹)"), money("registrationCharges", "Registration (₹)"), money("accessoriesCharges", "Accessories (₹)"), money("fittingCharges", "Fitting (₹)"), money("otherCharges", "Other approved charges (₹)"), { name: "expectedDeliveryDate", label: "Expected delivery date", type: "date" }]} /></Modal>} />
      <LinkTabs active={sp.status ?? "IN_STOCK"} tabs={[{ key: "IN_STOCK", label: "In stock", href: "/vehicles" }, ...STATUSES.map((s) => ({ key: s, label: s.toLowerCase().replace(/_/g, " "), href: `/vehicles?status=${s}` }))]} />
      <form className="mb-4 flex max-w-md gap-2"><Input name="search" defaultValue={sp.search} placeholder="Chassis, model or colour" />{sp.status && <input type="hidden" name="status" value={sp.status} />}<Button variant="outline">Search</Button></form>
      <Card>
        {rows.length ? (
          <Table>
            <thead><tr><Th>Vehicle</Th><Th>Chassis / engine</Th><Th>Branch</Th><Th>Status</Th><Th className="text-right">Ex-showroom</Th><Th className="text-right">On-road</Th>{cost && <Th className="text-right">Cost</Th>}<Th>Booking</Th><Th /></tr></thead>
            <tbody>{rows.map((v) => (
              <tr key={v.id}>
                <Td><span className="font-medium">{v.vehicleModel.name} {v.vehicleModel.variant}</span><div className="text-xs text-muted">{v.modelYear} · {v.colour}</div></Td>
                <Td className="font-mono text-xs">{v.vin}<div className="text-muted">{v.engineNumber}</div></Td>
                <Td className="text-xs">{v.branch.name}<div className="text-muted">{v.stockLocation}</div></Td>
                <Td><StatusBadge status={v.status} /><div className="text-xs text-muted">{v.registrationStatus.toLowerCase().replace("_", " ")}</div></Td>
                <Td className="text-right tabular-nums">{fmtMoney(v.exShowroomPrice)}</Td>
                <Td className="text-right tabular-nums">{fmtMoney(v.onRoadPrice)}</Td>
                {cost && <Td className="text-right tabular-nums">{fmtMoney(v.purchaseCost)}</Td>}
                <Td className="text-xs">{v.bookings.map((b) => `${b.bookingNumber} · ${b.customer.fullName}`).join(", ") || "—"}</Td>
                <Td>{can(actor, "showroom.pricing.approve") && !["DELIVERED", "TRANSFERRED", "RETURNED"].includes(v.status) && <Modal trigger="Pricing" title="Update pricing" description="Audited. Restricted to pricing approvers."><SimpleForm url={`/api/vehicles/${v.id}/pricing`} method="PUT" successMessage="Pricing updated." fields={[{ ...money("exShowroomPrice", "Ex-showroom", true), defaultValue: Number(v.exShowroomPrice) }, { ...money("insuranceCharges", "Insurance"), defaultValue: Number(v.insuranceCharges) }, { ...money("registrationCharges", "Registration"), defaultValue: Number(v.registrationCharges) }, { ...money("accessoriesCharges", "Accessories"), defaultValue: Number(v.accessoriesCharges) }, { ...money("fittingCharges", "Fitting"), defaultValue: Number(v.fittingCharges) }, { ...money("otherCharges", "Other"), defaultValue: Number(v.otherCharges) }]} /></Modal>}</Td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="No vehicles" />}
      </Card>
    </>
  );
}
