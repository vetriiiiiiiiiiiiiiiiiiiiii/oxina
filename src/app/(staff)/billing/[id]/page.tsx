import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/current";
import { can } from "@/lib/rbac/actor";
import { AppError } from "@/lib/errors";
import { getInvoiceForActor } from "@/lib/services/billing";
import { PageHeader } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { SimpleForm } from "@/components/forms/simple-form";
import { ActionButton } from "@/components/forms/action-button";
import { InvoiceDocument } from "@/components/billing/invoice-document";
import { PaymentForm } from "../../service/[id]/actions";
import { PrintButton } from "./print";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffPage();
  const inv = await getInvoiceForActor(actor, (await params).id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const finalized = ["FINALIZED", "PARTIALLY_PAID", "PAID"].includes(inv.status);
  return (
    <>
      <PageHeader
        eyebrow={inv.serviceJob ? <Link href={`/service/${inv.serviceJob.id}`}>Job {inv.serviceJob.jobNumber}</Link> : "Invoice"}
        title={inv.invoiceNumber ?? "Draft invoice"}
        actions={
          <>
            <PrintButton />
            {inv.status === "DRAFT" && can(actor, "billing.manage") && <ActionButton url={`/api/billing/invoices/${inv.id}/finalize`} confirm="Finalize? The invoice becomes immutable." success="Invoice finalized.">Finalize</ActionButton>}
            {["FINALIZED", "PARTIALLY_PAID"].includes(inv.status) && can(actor, "payments.record") && <PaymentForm invoiceId={inv.id} balance={Number(inv.balanceDue)} canConfirm={can(actor, "payments.confirm")} />}
            {finalized && can(actor, "billing.credit_note") && <Modal trigger="Credit note" title="Issue credit note" description="Reduces the amount due without altering the finalized invoice."><SimpleForm url={`/api/billing/invoices/${inv.id}/credit-note`} columns={1} successMessage="Credit note issued." fields={[{ name: "amount", label: "Amount (₹)", type: "number", required: true, step: "0.01" }, { name: "reason", label: "Reason", type: "textarea", required: true }]} /></Modal>}
            {inv.status !== "CANCELLED" && can(actor, "billing.credit_note") && !inv.payments.some((p) => p.status === "CONFIRMED") && <Modal trigger="Cancel invoice" title="Cancel invoice" triggerProps={{ variant: "ghost" }}><SimpleForm url={`/api/billing/invoices/${inv.id}/cancel`} columns={1} successMessage="Invoice cancelled." fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]} /></Modal>}
          </>
        }
      />
      <InvoiceDocument inv={inv} />
      {can(actor, "billing.credit_note") && inv.payments.some((p) => p.status === "CONFIRMED") && (
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {inv.payments.filter((p) => p.status === "CONFIRMED").map((p) => (
            <Modal key={p.id} trigger={`Request refund on ${p.receiptNumber}`} title="Request refund" description="A different authorised person must approve it."><SimpleForm url={`/api/payments/${p.id}/refund`} columns={1} successMessage="Refund requested." fields={[{ name: "amount", label: "Amount (₹)", type: "number", required: true, step: "0.01" }, { name: "reason", label: "Reason", type: "textarea", required: true }]} /></Modal>
          ))}
        </div>
      )}
    </>
  );
}
