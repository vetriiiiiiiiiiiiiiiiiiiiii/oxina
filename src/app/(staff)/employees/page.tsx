import { requireStaffPage } from "@/lib/auth/current";
import { can, requirePermission } from "@/lib/rbac/actor";
import { prisma } from "@/lib/db";
import { selectedBranchId, workingBranchId } from "@/lib/branch-context";
import { accessibleBranches } from "@/lib/services/org";
import { listEmployees } from "@/lib/services/people";
import { Badge, Button, Card, EmptyState, Input, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { SimpleForm } from "@/components/forms/simple-form";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Employees" };

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  const actor = await requireStaffPage();
  requirePermission(actor, "employees.view");
  const sp = await searchParams;
  const branches = await accessibleBranches(actor);
  const wb = await workingBranchId(actor, branches);
  const rows = await listEmployees(actor, { branchId: await selectedBranchId(actor), search: sp.search });
  const [departments, users] = wb ? await Promise.all([
    prisma.department.findMany({ where: { branchId: wb } }),
    prisma.user.findMany({ where: { userType: "STAFF", employee: null, branchAssignments: { some: { branchId: wb } } }, select: { id: true, name: true, email: true } }),
  ]) : [[], []];
  const managers = rows.filter((r) => r.branchId === wb);
  return (
    <>
      <PageHeader title="Employees" 
        actions={wb && can(actor, "employees.manage") && <Modal trigger="Add employee" title="Add employee" triggerProps={{ variant: "primary" }} wide><SimpleForm url="/api/employees" fixed={{ branchId: wb }} fields={[{ name: "employeeCode", label: "Employee ID", required: true }, { name: "fullName", label: "Full name", required: true }, { name: "designation", label: "Designation", required: true }, { name: "departmentId", label: "Department", type: "select", options: departments.map((d) => ({ value: d.id, label: d.name })) }, { name: "workEmail", label: "Work email", type: "email" }, { name: "workPhone", label: "Work phone" }, { name: "joiningDate", label: "Joining date", type: "date", required: true }, { name: "reportingManagerId", label: "Reporting manager", type: "select", options: managers.map((m) => ({ value: m.id, label: m.fullName })) }, { name: "userId", label: "Link login account", type: "select", options: users.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` })) }]} /></Modal>} />
      <form className="mb-4 flex max-w-md gap-2"><Input name="search" defaultValue={sp.search} placeholder="Name or employee ID" /><Button variant="outline">Search</Button></form>
      <Card>
        {rows.length ? (
          <Table>
            <thead><tr><Th>Employee</Th><Th>Designation</Th><Th>Branch / dept.</Th><Th>Reports to</Th><Th>Joined</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id}>
                <Td><span className="font-medium">{e.fullName}</span><div className="text-xs text-muted">{e.employeeCode}{e.workEmail ? ` · ${e.workEmail}` : ""}</div></Td>
                <Td>{e.designation}<div className="flex flex-wrap gap-1">{e.user?.roles.map((r) => <Badge key={r.role.name}>{r.role.name}</Badge>)}</div></Td>
                <Td className="text-xs">{e.branch.name}<div className="text-muted">{e.department?.name ?? "—"}</div></Td>
                <Td className="text-xs">{e.reportingManager?.fullName ?? "—"}</Td>
                <Td className="text-xs">{fmtDate(e.joiningDate)}</Td>
                <Td><StatusBadge status={e.status === "ACTIVE" ? "ACTIVE" : "CANCELLED"} label={e.status.toLowerCase().replace("_", " ")} /></Td>
                <Td>{can(actor, "employees.manage") && <Modal trigger="Edit" title={`Edit ${e.fullName}`}><SimpleForm url={`/api/employees/${e.id}`} method="PATCH" fields={[{ name: "designation", label: "Designation", defaultValue: e.designation }, { name: "workPhone", label: "Work phone", defaultValue: e.workPhone ?? "" }, { name: "status", label: "Employment status", type: "select", defaultValue: e.status, options: ["ACTIVE", "ON_LEAVE", "RESIGNED", "TERMINATED"].map((s) => ({ value: s, label: s.toLowerCase().replace("_", " ") })) }]} /></Modal>}</Td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="No employees" />}
      </Card>
    </>
  );
}
