import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCustomerPage } from "@/lib/auth/current";
import { AppError } from "@/lib/errors";
import { getInvoiceForActor } from "@/lib/services/billing";
import { InvoiceDocument } from "@/components/billing/invoice-document";

export const metadata = { title: "Invoice" };

export default async function PortalInvoice({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireCustomerPage();
  const inv = await getInvoiceForActor(actor, (await params).id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  return (
    <div className="space-y-4">
      <Link href="/portal" className="text-xs font-medium text-brand-600">← Back</Link>
      <InvoiceDocument inv={inv} customerView />
    </div>
  );
}
