import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/current";
import { can } from "@/lib/rbac/actor";
import { prisma } from "@/lib/db";
import { selectedBranchId, workingBranchId } from "@/lib/branch-context";
import { accessibleBranches, branchStaff } from "@/lib/services/org";
import { listBookings, listLeads } from "@/lib/services/showroom";
import { Card, EmptyState, Notice, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { SimpleForm } from "@/components/forms/simple-form";
import { LinkTabs } from "@/components/shell/tabs";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/utils";

export const metadata = { title: "Showroom" };

export default async function ShowroomPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  const actor = await requireStaffPage();
  const sp = await searchParams;
  const tab = sp.tab ?? "leads";
  const branches = await accessibleBranches(actor);
  const branchId = await selectedBranchId(actor);
  const wb = await workingBranchId(actor, branches);
  const unitId = wb ? branches.find((b) => b.id === wb)!.businessUnitId : undefined;
  const [models, sales] = await Promise.all([
    unitId ? prisma.vehicleModel.findMany({ where: { businessUnitId: unitId, isActive: true }, orderBy: [{ name: "asc" }] }) : [],
    wb && can(actor, "showroom.pricing.approve") ? branchStaff(actor, wb, ["SALES_EXECUTIVE", "BRANCH_MANAGER"]) : [],
  ]);
  const modelOpts = models.map((m) => ({ value: m.id, label: `${m.name} ${m.variant}`.trim() }));
  return (
    <>
      <PageHeader title="Showroom" description={can(actor, "showroom.pricing.approve") ? undefined : "Your leads and bookings."}
        actions={wb && can(actor, "showroom.leads.manage") && (
          <Modal trigger="New enquiry" title="New customer enquiry" triggerProps={{ variant: "primary" }}>
            <SimpleForm url="/api/showroom/leads" fixed={{ branchId: wb }} redirectPattern="/showroom/leads/{id}" successMessage="Lead created." fields={[{ name: "name", label: "Name", required: true }, { name: "phone", label: "Phone", type: "tel", required: true }, { name: "email", label: "Email", type: "email" }, { name: "interestedModelId", label: "Interested in", type: "select", options: modelOpts }, { name: "source", label: "Source", type: "select", required: true, options: ["WALK_IN", "PHONE", "WEBSITE", "REFERRAL", "CAMPAIGN"].map((s) => ({ value: s, label: s.replace("_", " ").toLowerCase() })) }, ...(sales.length ? [{ name: "assignedToId", label: "Assign to", type: "select" as const, options: sales.map((s) => ({ value: s.id, label: s.name })) }] : []), { name: "nextFollowUpAt", label: "Next follow-up", type: "datetime-local" }, { name: "notes", label: "Notes", type: "textarea" }]} />
          </Modal>
        )} />
      {!wb && <div className="mb-4"><Notice tone="warn">Select a branch in the header to create enquiries.</Notice></div>}
      <LinkTabs active={tab} tabs={[{ key: "leads", label: "Leads & follow-ups", href: "/showroom?tab=leads" }, { key: "bookings", label: "Bookings & deliveries", href: "/showroom?tab=bookings" }]} />
      {tab === "leads" ? <Leads /> : <Bookings />}
    </>
  );

  async function Leads() {
    const leads = await listLeads(actor, { branchId, status: sp.status });
    return (
      <Card>
        {leads.length ? (
          <Table>
            <thead><tr><Th>Lead</Th><Th>Interested in</Th><Th>Source</Th><Th>Status</Th><Th>Next follow-up</Th><Th>Owner</Th></tr></thead>
            <tbody>{leads.map((l) => {
              const overdue = l.nextFollowUpAt && l.nextFollowUpAt < new Date() && !["BOOKED", "LOST"].includes(l.status);
              return (
                <tr key={l.id} className="hover:bg-canvas/60">
                  <Td><Link href={`/showroom/leads/${l.id}`} className="font-medium text-brand-700 hover:underline">{l.name}</Link><div className="text-xs text-muted">{l.phone} · {l.branch.name}</div></Td>
                  <Td>{l.interestedModel ? `${l.interestedModel.name} ${l.interestedModel.variant}` : "—"}</Td>
                  <Td className="text-xs">{l.source.toLowerCase().replace("_", " ")}</Td>
                  <Td><StatusBadge status={l.status} />{l.lostReason && <div className="text-xs text-muted">{l.lostReason}</div>}</Td>
                  <Td className={`text-xs ${overdue ? "font-medium text-bad-700" : ""}`}>{fmtDateTime(l.nextFollowUpAt)}{overdue && " · overdue"}</Td>
                  <Td className="text-xs">{l.assignedTo?.name ?? "—"}</Td>
                </tr>
              );
            })}</tbody>
          </Table>
        ) : <EmptyState title="No leads yet" description="Record walk-ins, calls and web enquiries to start tracking follow-ups." />}
      </Card>
    );
  }

  async function Bookings() {
    const rows = await listBookings(actor, { branchId, status: sp.status });
    return (
      <Card>
        {rows.length ? (
          <Table>
            <thead><tr><Th>Booking</Th><Th>Customer</Th><Th>Model</Th><Th>Status</Th><Th className="text-right">Total</Th><Th>Delivery</Th></tr></thead>
            <tbody>{rows.map((b) => (
              <tr key={b.id} className="hover:bg-canvas/60">
                <Td><Link href={`/showroom/bookings/${b.id}`} className="font-mono text-brand-700 hover:underline">{b.bookingNumber}</Link><div className="text-xs text-muted">{fmtDate(b.createdAt)} · {b.branch.name}</div></Td>
                <Td>{b.customer.fullName}<div className="text-xs text-muted">{b.customer.phone}</div></Td>
                <Td>{b.vehicleModel.name} {b.vehicleModel.variant}<div className="text-xs text-muted">{b.vehicle ? `${b.vehicle.colour} · ${b.vehicle.vin}` : "vehicle not allocated"}</div></Td>
                <Td><StatusBadge status={b.status} /></Td>
                <Td className="text-right tabular-nums">{fmtMoney(b.totalAmount)}</Td>
                <Td className="text-xs">{fmtDateTime(b.deliveredAt ?? b.deliveryScheduledAt)}</Td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="No bookings" description="Bookings are created from a lead's page." />}
      </Card>
    );
  }
}
