import { Card, StatusBadge } from "@/components/ui";
import { fmtDateTime, fmtMoney } from "@/lib/utils";
import type { getInvoiceForActor } from "@/lib/services/billing";

type Inv = Awaited<ReturnType<typeof getInvoiceForActor>>;

/** Printable tax invoice. Customer view hides internal notes and unconfirmed payment details. */
export function InvoiceDocument({ inv, customerView = false }: { inv: Inv; customerView?: boolean }) {
  const tz = inv.branch.timezone;
  const payments = customerView ? inv.payments.filter((p) => p.status === "CONFIRMED") : inv.payments;
  return (
    <Card className="overflow-hidden print:border-0 print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-navy-900 px-6 py-5">
        <div><p className="text-[13px] text-muted">{inv.status === "DRAFT" ? "Draft invoice" : "Tax invoice"}</p><p className="mt-1 font-mono text-lg font-semibold">{inv.invoiceNumber ?? "—"}</p></div>
        <div className="text-right text-[12px] text-muted"><p className="font-medium text-ink">{inv.branch.name}</p>{inv.branch.addressLine && <p>{inv.branch.addressLine}, {inv.branch.city}</p>}{inv.branch.gstin && <p>GSTIN {inv.branch.gstin}</p>}</div>
      </div>
      <div className="grid gap-4 border-b border-line px-6 py-4 text-sm sm:grid-cols-3">
        <div><p className="text-xs text-muted">Billed to</p><p className="font-medium">{inv.customer.fullName}</p><p className="text-xs text-muted">{inv.customer.phone}</p></div>
        <div><p className="text-xs text-muted">Reference</p><p>{inv.serviceJob ? `Job ${inv.serviceJob.jobNumber}` : inv.booking ? `Booking ${inv.booking.bookingNumber}` : "—"}</p>{inv.serviceJob && <p className="text-xs text-muted">{inv.serviceJob.customerVehicle.modelName} · {inv.serviceJob.customerVehicle.registrationNumber}</p>}</div>
        <div><p className="text-xs text-muted">Issued</p><p>{fmtDateTime(inv.finalizedAt, tz)}</p><StatusBadge status={inv.status} /></div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-xs text-muted"><tr><th className="px-6 py-2 text-left font-medium">Description</th><th className="px-3 py-2 text-left font-medium">HSN/SAC</th><th className="px-3 py-2 text-right font-medium">Qty</th><th className="px-3 py-2 text-right font-medium">Rate</th><th className="px-3 py-2 text-right font-medium">Disc.</th><th className="px-3 py-2 text-right font-medium">GST</th><th className="px-6 py-2 text-right font-medium">Amount</th></tr></thead>
          <tbody>{inv.lines.map((l) => <tr key={l.id} className="border-b border-line/60"><td className="px-6 py-2">{l.description}</td><td className="px-3 py-2 text-xs text-muted">{l.hsnSac ?? "—"}</td><td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td><td className="px-3 py-2 text-right tabular-nums">{fmtMoney(l.unitPrice)}</td><td className="px-3 py-2 text-right tabular-nums">{fmtMoney(l.discount)}</td><td className="px-3 py-2 text-right tabular-nums">{Number(l.taxRatePercent)}% · {fmtMoney(l.taxAmount)}</td><td className="px-6 py-2 text-right tabular-nums">{fmtMoney(l.lineTotal)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="grid gap-6 px-6 py-5 sm:grid-cols-2">
        <div className="text-xs text-muted">
          {payments.length > 0 && <><p className="mb-1 font-medium text-ink">Payments</p><ul className="space-y-0.5">{payments.map((p) => <li key={p.id}>{fmtDateTime(p.confirmedAt ?? p.createdAt, tz)} · {p.method.toLowerCase()} · {fmtMoney(p.amount)}{p.receiptNumber ? ` · ${p.receiptNumber}` : ""}{!customerView && ` · ${p.status.toLowerCase()}`}</li>)}</ul></>}
          {inv.creditNotes.length > 0 && <><p className="mb-1 mt-3 font-medium text-ink">Credit notes</p><ul>{inv.creditNotes.map((c) => <li key={c.id}>{c.creditNoteNumber} · {fmtMoney(c.amount)} · {c.reason}</li>)}</ul></>}
          {inv.status === "CANCELLED" && <p className="mt-2 text-bad-700">Cancelled: {inv.cancelReason}</p>}
        </div>
        <dl className="space-y-1 text-sm">
          {([["Subtotal", inv.subtotal], ["Discount", inv.discountTotal], ...(Number(inv.igstTotal) > 0 ? [["IGST", inv.igstTotal]] : [["CGST", inv.cgstTotal], ["SGST", inv.sgstTotal]])] as [string, unknown][]).map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-muted">{k}</dt><dd className="tabular-nums">{fmtMoney(v)}</dd></div>)}
          <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{fmtMoney(inv.grandTotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Paid</dt><dd className="tabular-nums">{fmtMoney(inv.amountPaid)}</dd></div>
          {Number(inv.creditedAmount) > 0 && <div className="flex justify-between"><dt className="text-muted">Credited</dt><dd className="tabular-nums">{fmtMoney(inv.creditedAmount)}</dd></div>}
          <div className="flex justify-between font-medium"><dt>Balance due</dt><dd className="tabular-nums">{fmtMoney(inv.balanceDue)}</dd></div>
        </dl>
      </div>
      <p className="border-t border-line px-6 py-3 text-[11px] text-faint">Tax treatment is configurable; GST rules must be validated by the business before production use.</p>
    </Card>
  );
}
