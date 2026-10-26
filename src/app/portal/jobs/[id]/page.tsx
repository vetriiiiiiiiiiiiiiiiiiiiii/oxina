import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCustomerPage } from "@/lib/auth/current";
import { AppError } from "@/lib/errors";
import { customerJobView } from "@/lib/services/service/delivery";
import { PART_UNAVAILABLE_CUSTOMER_MESSAGE, JOB_STATUS_LABEL } from "@/lib/service/stages";
import { Card, CardBody, CardHeader, Notice, StatusBadge } from "@/components/ui";
import { EtaPanel, ServiceTimeline } from "@/components/service/timeline";
import { LiveRefresh } from "@/components/forms/live-refresh";
import { ActionButton } from "@/components/forms/action-button";
import { fmtDateTime, fmtMoney } from "@/lib/utils";
import { EstimateApproval, FeedbackForm, PhotoLink } from "./client";

export const metadata = { title: "Service tracking" };

export default async function PortalJob({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireCustomerPage();
  const { id } = await params;
  const v = await customerJobView(actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const tz = v.branch.timezone;
  const pending = v.estimates.find((e) => e.status === "SENT");
  return (
    <div className="space-y-5">
      <Link href="/portal" className="text-xs font-medium text-brand-600">← My vehicles</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{v.vehicle.modelName}</h1>
          <p className="text-sm text-muted">{v.vehicle.registrationNumber} · Job {v.jobNumber}</p>
        </div>
        <div className="flex items-center gap-3"><StatusBadge status={v.status} label={JOB_STATUS_LABEL[v.status]} /><LiveRefresh jobId={v.id} /></div>
      </div>

      <EtaPanel eta={v.eta} tz={tz} status={v.status} partsDelayed={v.partsDelayed} />
      {v.partsDelayed && <Notice tone="warn">{PART_UNAVAILABLE_CUSTOMER_MESSAGE}</Notice>}
      {!v.acknowledgedAt && !["DELIVERED", "CLOSED", "CANCELLED"].includes(v.status) && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <span>Please confirm the job card details (vehicle, odometer, reported problems) recorded at reception.</span>
          <ActionButton size="sm" url={`/api/service/jobs/${v.id}/acknowledge`} success="Thank you — job card acknowledged.">Acknowledge job card</ActionButton>
        </Card>
      )}

      {pending && <EstimateApproval estimate={JSON.parse(JSON.stringify(pending))} />}

      <Card>
        <CardHeader title="Service progress" description="Updates appear here as soon as our team records them." />
        <CardBody><ServiceTimeline stages={v.stages} events={v.events} tz={tz} /></CardBody>
      </Card>

      {v.tasks.length > 0 && (
        <Card><CardHeader title="Approved work" /><ul className="divide-y divide-line">{v.tasks.map((t) => <li key={t.id} className="flex justify-between px-5 py-3 text-sm"><span>{t.title}</span><StatusBadge status={t.status} label={t.status === "IN_PROGRESS" ? "in progress" : t.status === "COMPLETED" ? "done" : t.status === "BLOCKED" ? "waiting for parts" : "scheduled"} /></li>)}</ul></Card>
      )}

      {v.estimates.filter((e) => e.status !== "SENT").map((e) => (
        <Card key={e.id}>
          <CardHeader title={`${e.kind === "SUPPLEMENTARY" ? "Additional work" : "Estimate"} ${e.estimateNumber}`} action={<StatusBadge status={e.status} />} />
          <ul className="divide-y divide-line text-sm">{e.lines.map((l) => <li key={l.id} className="flex justify-between gap-3 px-5 py-2.5"><span>{l.description}</span><span className="whitespace-nowrap tabular-nums">{fmtMoney(l.lineTotal)} <StatusBadge status={l.approvalStatus} /></span></li>)}</ul>
          <CardBody className="text-right text-sm">Approved total <b>{fmtMoney(e.approvedTotal)}</b></CardBody>
        </Card>
      ))}

      {v.invoice && (
        <Card>
          <CardHeader title="Final invoice" action={<Link className="text-xs font-medium text-brand-600" href={`/portal/invoices/${v.invoice.id}`}>View →</Link>} />
          <CardBody className="flex flex-wrap gap-x-6 gap-y-2 text-sm"><span>{v.invoice.invoiceNumber}</span><span>Total <b>{fmtMoney(v.invoice.grandTotal)}</b></span><span>Paid {fmtMoney(v.invoice.amountPaid)}</span><span className={Number(v.invoice.balanceDue) > 0 ? "font-medium text-warn-700" : "text-ok-700"}>Balance {fmtMoney(v.invoice.balanceDue)}</span></CardBody>
        </Card>
      )}

      {v.photos.length > 0 && <Card><CardHeader title="Photos shared with you" /><CardBody className="flex flex-wrap gap-2">{v.photos.map((p) => <PhotoLink key={p.id} fileId={p.fileId} label={p.caption ?? p.stage.toLowerCase()} />)}</CardBody></Card>}

      {["DELIVERED", "CLOSED"].includes(v.status) && (v.feedback ? <Notice tone="ok" title={`Thanks for your feedback (${v.feedback.rating}/5)`}>{v.feedback.comments ?? ""}</Notice> : <FeedbackForm jobId={v.id} />)}

      <Card>
        <CardHeader title="Your service centre" />
        <CardBody className="space-y-1.5 text-sm">
          <p className="font-medium">{v.branch.name}</p>
          {v.branch.address && <p className="flex items-center gap-1.5 text-muted">{v.branch.address}</p>}
          <p className="flex items-center gap-1.5 text-muted">Service advisor {v.advisor.name}{v.advisor.phone ? ` · ${v.advisor.phone}` : ""}</p>
          <p className="text-xs text-faint">Received {fmtDateTime(v.receivedAt, tz)}</p>
        </CardBody>
      </Card>
    </div>
  );
}
