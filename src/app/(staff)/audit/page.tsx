import { requireStaffPage } from "@/lib/auth/current";
import { selectedBranchId } from "@/lib/branch-context";
import { auditQuery, listAudit } from "@/lib/services/misc";
import { Button, Card, EmptyState, Input, PageHeader, Table, Td, Th } from "@/components/ui";
import { Pager } from "@/components/shell/tabs";
import { fmtDateTime } from "@/lib/utils";

export const metadata = { title: "Audit logs" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const actor = await requireStaffPage();
  const sp = await searchParams;
  const q = auditQuery.parse({ ...sp, branchId: await selectedBranchId(actor) });
  const data = await listAudit(actor, q);
  return (
    <>
      <PageHeader title="Audit log" description="Entries cannot be edited or deleted. Passwords and identifiers are never stored here." />
      <form className="mb-4 flex flex-wrap gap-2"><Input name="action" defaultValue={q.action} placeholder="Action contains… (e.g. invoice, login)" className="max-w-xs" /><Input name="entityType" defaultValue={q.entityType} placeholder="Entity (e.g. Invoice)" className="max-w-[200px]" /><Button variant="outline">Filter</Button></form>
      <Card>
        {data.rows.length ? (
          <Table>
            <thead><tr><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Entity</Th><Th>Details</Th><Th>IP</Th></tr></thead>
            <tbody>{data.rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</Td>
                <Td className="text-xs">{r.actor?.name ?? "System"}</Td>
                <Td className="font-mono text-xs">{r.action}</Td>
                <Td className="text-xs">{r.entityType}<div className="font-mono text-[10px] text-faint">{r.entityId?.slice(0, 8)}</div></Td>
                <Td className="max-w-md truncate font-mono text-[11px] text-muted" title={JSON.stringify(r.after ?? {})}>{r.after ? JSON.stringify(r.after).slice(0, 120) : "—"}</Td>
                <Td className="text-xs">{r.ipAddress ?? "—"}</Td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="No entries" />}
        <Pager page={data.page} pageSize={data.pageSize} total={data.total} base={`/audit?action=${q.action ?? ""}&entityType=${q.entityType ?? ""}`} />
      </Card>
    </>
  );
}
