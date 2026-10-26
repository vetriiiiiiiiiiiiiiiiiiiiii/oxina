import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/current";
import { selectedBranchId } from "@/lib/branch-context";
import { listFollowUps } from "@/lib/services/service/delivery";
import { Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { SimpleForm } from "@/components/forms/simple-form";
import { LinkTabs } from "@/components/shell/tabs";
import { fmtDateTime, titleCase } from "@/lib/utils";

export const metadata = { title: "Follow-ups" };

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ due?: "today" | "overdue" | "upcoming" }> }) {
  const actor = await requireStaffPage();
  const due = (await searchParams).due ?? "today";
  const rows = await listFollowUps(actor, { branchId: await selectedBranchId(actor), due });
  return (
    <>
      <PageHeader title="Follow-up calls" description="Created at handover: next-day call, 3-day call, feedback request and service reminder." />
      <LinkTabs active={due} tabs={[{ key: "today", label: "Due today", href: "?due=today" }, { key: "overdue", label: "Overdue", href: "?due=overdue" }, { key: "upcoming", label: "Upcoming", href: "?due=upcoming" }]} />
      <Card>
        {rows.length ? (
          <Table>
            <thead><tr><Th>Customer</Th><Th>Type</Th><Th>Job</Th><Th>Due</Th><Th>Attempts</Th><Th>Assigned</Th><Th /></tr></thead>
            <tbody>{rows.map((f) => (
              <tr key={f.id}>
                <Td>{f.customer.fullName}<div className="text-xs text-muted">{f.customer.phone}</div></Td>
                <Td>{titleCase(f.type)}</Td>
                <Td>{f.serviceJob ? <Link className="text-brand-700 hover:underline" href={`/service/${f.serviceJob.id}`}>{f.serviceJob.jobNumber}</Link> : "—"}</Td>
                <Td className="text-xs">{fmtDateTime(f.dueAt)}</Td>
                <Td>{f.attempts}{f.outcome && <div className="text-xs text-muted">{f.outcome}</div>}</Td>
                <Td className="text-xs">{f.assignedTo?.name ?? "—"}</Td>
                <Td>
                  <Modal trigger="Record" title={`Follow-up: ${f.customer.fullName}`}>
                    <SimpleForm url={`/api/service/followups/${f.id}`} successMessage="Follow-up recorded." fields={[{ name: "status", label: "Outcome", type: "select", required: true, options: [{ value: "COMPLETED", label: "Completed" }, { value: "NO_ANSWER", label: "No answer — retry" }, { value: "RESCHEDULED", label: "Reschedule" }, { value: "CANCELLED", label: "Cancel" }] }, { name: "outcome", label: "Summary" }, { name: "nextDueAt", label: "Next follow-up", type: "datetime-local" }, { name: "notes", label: "Notes", type: "textarea" }]} />
                  </Modal>
                </Td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="Nothing due" />}
      </Card>
    </>
  );
}
