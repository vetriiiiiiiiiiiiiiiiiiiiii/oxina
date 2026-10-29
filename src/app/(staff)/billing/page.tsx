import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/current";
import { can } from "@/lib/rbac/actor";
import { prisma } from "@/lib/db";
import { selectedBranchId, workingBranchId } from "@/lib/branch-context";
import { invoiceQuery, listInvoices, paymentScopeFor } from "@/lib/services/billing";
import { listExpenses } from "@/lib/services/misc";
import { accessibleBranches } from "@/lib/services/org";
import { branchFilter } from "@/lib/rbac/actor";
import { Card, CardHeader, EmptyState, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { SimpleForm } from "@/components/forms/simple-form";
import { ActionButton } from "@/components/forms/action-button";
import { LinkTabs, Pager } from "@/components/shell/tabs";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/utils";

export const metadata = { title: "Billing & Payments" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const actor = await requireStaffPage();
  const sp = await searchParams;
  const tab = sp.tab ?? "invoices";
  const branchId = await selectedBranchId(actor);
  const canBilling = can(actor, "billing.view") || can(actor, "billing.manage");
  const tabs = [
    ...(canBilling ? [{ key: "invoices", label: "Invoices", href: "/billing?tab=invoices" }, { key: "payments", label: "Payments to confirm", href: "/billing?tab=payments" }, { key: "refunds", label: "Refunds", href: "/billing?tab=refunds" }] : []),
    ...(can(actor, "expenses.submit") || can(actor, "expenses.approve") ? [{ key: "expenses", label: "Expenses", href: "/billing?tab=expenses" }] : []),
  ];
  return (
    <>
      <PageHeader title="Billing" description="A finalized invoice can't be edited — use a credit note or cancel it." />
      <LinkTabs active={tab} tabs={tabs} />
      {tab === "invoices" && canBilling && <Invoices />}
      {tab === "payments" && canBilling && <Payments />}
      {tab === "refunds" && canBilling && <Refunds />}
      {tab === "expenses" && <Expenses />}
    </>
  );

  async function Invoices() {
    const q = invoiceQuery.parse({ ...sp, branchId });
    const data = await listInvoices(actor, q);
    return (
      <>
        <LinkTabs active={q.status ?? "ALL"} tabs={[["ALL", "All"], ["OUTSTANDING", "Outstanding"], ["DRAFT", "Draft"], ["PAID", "Paid"], ["CANCELLED", "Cancelled"]].map(([k, l]) => ({ key: k, label: l, href: k === "ALL" ? "/billing" : `/billing?status=${k}` }))} />
        <Card>
          {data.rows.length ? (
            <Table>
              <thead><tr><Th>Invoice</Th><Th>Customer</Th><Th>Reference</Th><Th>Status</Th><Th className="text-right">Total</Th><Th className="text-right">Balance</Th><Th>Issued</Th></tr></thead>
              <tbody>{data.rows.map((i) => (
                <tr key={i.id} className="hover:bg-canvas/60">
                  <Td><Link href={`/billing/${i.id}`} className="font-mono text-brand-700 hover:underline">{i.invoiceNumber ?? "Draft"}</Link><div className="text-xs text-muted">{i.branch.name} · {i.kind.toLowerCase().replace("_", " ")}</div></Td>
                  <Td>{i.customer.fullName}</Td>
                  <Td className="text-xs">{i.serviceJob?.jobNumber ?? i.booking?.bookingNumber ?? "—"}</Td>
                  <Td><StatusBadge status={i.status} /></Td>
                  <Td className="text-right tabular-nums">{fmtMoney(i.grandTotal)}</Td>
                  <Td className="text-right tabular-nums">{fmtMoney(i.balanceDue)}</Td>
                  <Td className="text-xs">{fmtDate(i.finalizedAt)}</Td>
                </tr>
              ))}</tbody>
            </Table>
          ) : <EmptyState title="No invoices" />}
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} base={`/billing?status=${q.status ?? ""}`} />
        </Card>
      </>
    );
  }

  async function Payments() {
    const rows = await prisma.payment.findMany({ where: { ...branchFilter(actor, branchId), ...paymentScopeFor(actor), status: "PENDING_CONFIRMATION" }, orderBy: { createdAt: "asc" }, include: { customer: { select: { fullName: true } }, invoice: { select: { id: true, invoiceNumber: true } }, booking: { select: { id: true, bookingNumber: true } } } });
    return (
      <Card>
        {rows.length ? (
          <Table>
            <thead><tr><Th>Recorded</Th><Th>Customer</Th><Th>For</Th><Th>Method / ref</Th><Th className="text-right">Amount</Th><Th /></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id}>
                <Td className="text-xs">{fmtDateTime(p.createdAt)}</Td>
                <Td>{p.customer.fullName}</Td>
                <Td className="text-xs">{p.invoice ? <Link className="text-brand-700" href={`/billing/${p.invoice.id}`}>{p.invoice.invoiceNumber}</Link> : p.booking ? <Link className="text-brand-700" href={`/showroom/bookings/${p.booking.id}`}>{p.booking.bookingNumber}</Link> : "—"}</Td>
                <Td className="text-xs">{p.method.toLowerCase()} {p.reference ? `· ${p.reference}` : ""}</Td>
                <Td className="text-right tabular-nums">{fmtMoney(p.amount)}</Td>
                <Td>{can(actor, "payments.confirm") && <div className="flex gap-2"><ActionButton size="sm" variant="success" url={`/api/payments/${p.id}/confirm`} success="Confirmed; receipt issued.">Confirm</ActionButton><ActionButton size="sm" variant="ghost" url={`/api/payments/${p.id}/reject`} body={{ reason: "Not received / failed verification" }} confirm="Mark this payment as failed?" success="Marked failed.">Failed</ActionButton></div>}</Td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="No payments awaiting confirmation" description="Only confirmed payments reduce invoice balances." />}
      </Card>
    );
  }

  async function Refunds() {
    const rows = await prisma.refund.findMany({ where: { payment: { ...branchFilter(actor, branchId), ...paymentScopeFor(actor) } }, orderBy: { createdAt: "desc" }, take: 100, include: { payment: { select: { receiptNumber: true, amount: true, customer: { select: { fullName: true } } } } } });
    return (
      <Card>
        {rows.length ? (
          <Table>
            <thead><tr><Th>Requested</Th><Th>Customer</Th><Th>Receipt</Th><Th>Reason</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><Td className="text-xs">{fmtDateTime(r.createdAt)}</Td><Td>{r.payment.customer.fullName}</Td><Td className="text-xs">{r.payment.receiptNumber}</Td><Td className="text-xs">{r.reason}</Td><Td className="text-right">{fmtMoney(r.amount)}</Td><Td><StatusBadge status={r.status} /></Td>
                <Td>{r.status === "REQUESTED" && can(actor, "refunds.approve") && r.requestedById !== actor.userId && <div className="flex gap-2"><ActionButton size="sm" url={`/api/payments/refunds/${r.id}`} body={{ approve: true }} success="Refund approved.">Approve</ActionButton><ActionButton size="sm" variant="ghost" url={`/api/payments/refunds/${r.id}`} body={{ approve: false }} success="Refund rejected.">Reject</ActionButton></div>}</Td></tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="No refunds" description="Request a refund from a confirmed payment on the invoice page." />}
      </Card>
    );
  }

  async function Expenses() {
    const branches = await accessibleBranches(actor);
    const wb = await workingBranchId(actor, branches);
    const rows = await listExpenses(actor, { branchId });
    return (
      <Card>
        <CardHeader title="Expenses" action={wb && <Modal trigger="Submit expense" title="Submit expense" triggerProps={{ variant: "primary" }}><SimpleForm url="/api/expenses" fixed={{ branchId: wb }} successMessage="Expense submitted for approval." fields={[{ name: "category", label: "Category", required: true, placeholder: "Utilities, Repairs, Travel…" }, { name: "amount", label: "Amount (₹)", type: "number", required: true, step: "0.01" }, { name: "incurredOn", label: "Date", type: "date", required: true }, { name: "description", label: "Description", type: "textarea", required: true }]} /></Modal>} />
        {rows.length ? (
          <Table>
            <thead><tr><Th>Date</Th><Th>Branch</Th><Th>Category</Th><Th>Description</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id}><Td className="text-xs">{fmtDate(e.incurredOn)}</Td><Td className="text-xs">{e.branch.name}</Td><Td>{e.category}</Td><Td className="text-xs">{e.description}</Td><Td className="text-right">{fmtMoney(e.amount)}</Td><Td><StatusBadge status={e.status} /></Td>
                <Td>{e.status === "PENDING" && can(actor, "expenses.approve") && e.submittedById !== actor.userId && <div className="flex gap-2"><ActionButton size="sm" url={`/api/expenses/${e.id}`} body={{ approve: true }} success="Approved.">Approve</ActionButton><ActionButton size="sm" variant="ghost" url={`/api/expenses/${e.id}`} body={{ approve: false }} success="Rejected.">Reject</ActionButton></div>}</Td></tr>
            ))}</tbody>
          </Table>
        ) : <EmptyState title="No expenses" description={wb ? undefined : "Select a branch in the header to submit an expense."} />}
      </Card>
    );
  }
}
