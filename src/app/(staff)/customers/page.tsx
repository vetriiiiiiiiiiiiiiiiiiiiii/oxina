import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/current";
import { can } from "@/lib/rbac/actor";
import { selectedBranchId, workingBranchId } from "@/lib/branch-context";
import { accessibleBranches } from "@/lib/services/org";
import { listCustomers } from "@/lib/services/customers";
import { Button, Card, EmptyState, Input, PageHeader, Table, Td, Th } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { SimpleForm } from "@/components/forms/simple-form";
import { Pager } from "@/components/shell/tabs";
import { fmtDate } from "@/lib/utils";
import { RegPlate } from "@/components/visual/plate";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ search?: string; page?: string }> }) {
  const actor = await requireStaffPage();
  const sp = await searchParams;
  const branches = await accessibleBranches(actor);
  void (await selectedBranchId(actor));
  const wb = await workingBranchId(actor, branches);
  const data = await listCustomers(actor, { search: sp.search, page: Number(sp.page) || 1 });
  return (
    <>
      <PageHeader title="Customers" description="Customers of your branches."
        actions={wb && can(actor, "customers.manage") && <Modal trigger="New customer" title="Register customer" description="Service-communication consent is recorded with notice version 2026-10." triggerProps={{ variant: "primary" }}><SimpleForm url="/api/customers" fixed={{ branchId: wb }} redirectPattern="/customers/{id}" successMessage="Customer registered." fields={[{ name: "fullName", label: "Full name", required: true }, { name: "phone", label: "Mobile", type: "tel", required: true }, { name: "email", label: "Email", type: "email" }, { name: "city", label: "City" }, { name: "stateCode", label: "GST state code", hint: "e.g. 33 for Tamil Nadu" }, { name: "postalCode", label: "PIN code" }, { name: "addressLine", label: "Address", type: "textarea" }]} /></Modal>} />
      <form className="mb-4 flex max-w-md gap-2"><Input name="search" defaultValue={sp.search} placeholder="Name, phone, customer code or registration" /><Button variant="outline">Search</Button></form>
      <Card>
        {data.rows.length ? (
          <Table>
            <thead><tr><Th>Customer</Th><Th>Contact</Th><Th>Vehicles</Th><Th className="text-right">Service visits</Th><Th>Since</Th></tr></thead>
            <tbody>{data.rows.map((c) => (
              <tr key={c.id} className="hover:bg-canvas/60">
                <Td><Link href={`/customers/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.fullName}</Link><div className="text-xs text-muted">{c.customerCode}</div></Td>
                <Td className="text-xs">{c.phone}{c.email && <div className="text-muted">{c.email}</div>}</Td>
                <Td className="text-xs">{c.vehicles.length ? <div className="flex flex-wrap gap-1.5">{c.vehicles.map((v) => <RegPlate key={v.registrationNumber} reg={v.registrationNumber} />)}</div> : "—"}</Td>
                <Td className="text-right">{c._count.serviceJobs}</Td>
                <Td className="text-xs">{fmtDate(c.createdAt)}</Td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="No customers found" />}
        <Pager page={data.page} pageSize={data.pageSize} total={data.total} base={`/customers?search=${sp.search ?? ""}`} />
      </Card>
    </>
  );
}
