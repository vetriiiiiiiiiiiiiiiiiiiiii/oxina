import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/current";
import { can } from "@/lib/rbac/actor";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { staffJobDetail } from "@/lib/services/service/delivery";
import { branchStaff } from "@/lib/services/org";
import { JOB_STATUS_LABEL } from "@/lib/service/stages";
import { Badge, Card, CardBody, CardHeader, DL, EmptyState, Notice, StatusBadge, Table, Td, Th } from "@/components/ui";
import { EtaPanel, ServiceTimeline } from "@/components/service/timeline";
import { LiveRefresh } from "@/components/forms/live-refresh";
import { NextStep, SectionNav, StageBar } from "./progress";
import { RegPlate } from "@/components/visual/plate";
import { ActionButton } from "@/components/forms/action-button";
import { fmtDateTime, fmtElapsed, fmtMinutes, fmtMoney, titleCase } from "@/lib/utils";
import {
  AssignStaff, CancelJob, DecisionRecorder, DiscountEditor, HandoverForm, InspectionForm, PaymentForm, PhotoUpload, ProcurementForm,
  QcCompleteForm, ReadyForm, SendEstimate, TaskActions, TestRideEnd, TestRideStart,
} from "./actions";

export const metadata = { title: "Service job" };

export default async function JobWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffPage();
  const { id } = await params;
  const detail = await staffJobDetail(actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const { job, full, events, stages, activity, stock } = detail;
  const tz = job.branch.timezone;
  const open = !["DELIVERED", "CLOSED", "CANCELLED"].includes(job.status);
  const staff = await branchStaff(actor, job.branchId);
  const byRole = (k: string) => staff.filter((s) => s.roles.some((r) => r.role.key === k)).map((s) => ({ id: s.id, name: s.name, code: s.employee?.employeeCode ?? null }));
  const mechanics = byRole("MECHANIC");
  const needInspectionData = can(actor, "service.inspect") && ["RECEIVED", "INSPECTION"].includes(job.status);
  const needSupplementary = (can(actor, "service.estimate.manage") || can(actor, "service.repair.work")) && ["APPROVED", "PARTS_PENDING", "IN_REPAIR", "QUALITY_CHECK"].includes(job.status);
  const [items, durations] = needInspectionData || needSupplementary
    ? await Promise.all([
        prisma.inventoryItem.findMany({ where: { businessUnitId: job.branch.businessUnitId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, partNumber: true, name: true, sellingPrice: true, compatibleModels: true } }),
        prisma.repairDurationStandard.findMany({ where: { businessUnitId: job.branch.businessUnitId, OR: [{ branchId: null }, { branchId: job.branchId }], vehicleModelId: null }, orderBy: { label: "asc" } }),
      ])
    : [[], []];
  const itemOpts = items.map((i) => ({ id: i.id, label: `${i.name} (${i.partNumber})`, price: Number(i.sellingPrice), compatible: i.compatibleModels }));
  const durOpts = durations.map((d) => ({ key: d.taskKey, label: d.label, min: d.minMinutes, max: d.maxMinutes, labour: Number(d.defaultLabour) }));
  const breakdown = (job.etaBreakdown ?? {}) as { activeMinutes?: { min: number; max: number }; queueMinutes?: { min: number; max: number }; partsWaitMinutes?: number; elapsedMinutes?: number; reason?: string; unknownParts?: string[] };
  const liveTasks = full.tasks.filter((t) => t.status !== "CANCELLED");
  const latestQc = full.qualityInspections.at(-1);
  const invoice = full.invoices.find((i) => i.status !== "CANCELLED");
  const shortages = full.partRequests.filter((r) => ["UNAVAILABLE", "AWAITING_PROCUREMENT"].includes(r.status));
  const pendingApprovalTasks = liveTasks.filter((t) => t.requiresApproval && !t.approved);
  const requestedLines = new Set(full.partRequests.map((r) => r.estimateLineId).filter(Boolean));
  const partsToRequest = full.estimates.flatMap((e) => e.lines).filter((l) => l.type === "PART" && l.approvalStatus === "APPROVED" && l.inventoryItemId && !requestedLines.has(l.id) && liveTasks.some((t) => t.id === l.repairTaskId)).length;
  const unassigned = liveTasks.filter((t) => t.status !== "COMPLETED" && !t.assignedMechanicId && (t.approved || !t.requiresApproval)).length;
  const waitingIssue = full.partRequests.filter((r) => ["RESERVED", "PICKING", "PICKED"].includes(r.status)).length;
  const doneTasks = liveTasks.filter((t) => t.status === "COMPLETED").length;
  const sentEstimate = full.estimates.find((e) => e.status === "SENT");
  const sinceText = (d: Date | null | undefined) => (d ? fmtElapsed(Math.round((Date.now() - new Date(d).getTime()) / 60_000)) : "");
  const next = ((): { title: string; detail?: React.ReactNode; tone?: "navy" | "warn" | "ok" | "muted"; action?: React.ReactNode } => {
    switch (job.status) {
      case "RECEIVED":
        return { title: "Inspect the vehicle", detail: `Waiting ${sinceText(job.receivedAt)} since reception.`, action: can(actor, "service.inspect") ? <ActionButton size="sm" url={`/api/service/jobs/${job.id}/inspection/start`} success="Inspection started.">Start inspection</ActionButton> : undefined };
      case "INSPECTION":
        return { title: "Record the findings and recommended repairs", detail: "Completing the inspection drafts the estimate.", action: <a href="#inspection" className="text-[13px] text-brand-600 hover:underline">Go to inspection ↓</a> };
      case "AWAITING_APPROVAL":
        return sentEstimate
          ? { title: "Waiting for the customer to approve the estimate", tone: "warn", detail: <>Sent {sinceText(sentEstimate.sentAt)} ago. Call {job.customer.fullName} on {job.customer.phone} if needed, and record their answer.</>, action: <a href="#estimates" className="text-[13px] text-brand-600 hover:underline">Estimate ↓</a> }
          : { title: "Send the estimate to the customer", detail: "Check discounts on the draft, then send it.", action: <a href="#estimates" className="text-[13px] text-brand-600 hover:underline">Draft estimate ↓</a> };
      case "APPROVED":
      case "PARTS_PENDING":
      case "IN_REPAIR":
        if (partsToRequest) return { title: `Check stock for ${partsToRequest} approved part(s)`, detail: "Reserves what is on the shelf and records anything missing.", action: can(actor, "service.parts.request") ? <ActionButton size="sm" url={`/api/service/jobs/${job.id}/parts/verify`} success="Availability checked — parts reserved where in stock, shortages recorded.">Check parts</ActionButton> : undefined };
        if (shortages.some((s) => !s.expectedAvailableAt)) return { title: "Find out when the missing part will arrive", tone: "warn", detail: "Until a date is recorded the customer is told the completion time is to be confirmed.", action: <a href="#parts" className="text-[13px] text-brand-600 hover:underline">Parts ↓</a> };
        if (unassigned) return { title: `Assign a mechanic to ${unassigned} task(s)`, action: <a href="#tasks" className="text-[13px] text-brand-600 hover:underline">Tasks ↓</a> };
        if (shortages.length) return { title: "Waiting for parts to arrive", tone: "warn", detail: `Expected ${fmtDateTime(shortages.map((s) => s.expectedAvailableAt!).sort((a, b) => +a - +b).at(-1), tz)}. Other tasks can continue.` };
        if (waitingIssue) return { title: `Stores to issue ${waitingIssue} reserved part(s) to the mechanic`, action: <Link href="/inventory/requests" className="text-[13px] text-brand-600 hover:underline">Parts queue →</Link> };
        return { title: "Repairs under way", detail: `${doneTasks} of ${liveTasks.length} task(s) finished.`, action: <a href="#tasks" className="text-[13px] text-brand-600 hover:underline">Tasks ↓</a> };
      case "QUALITY_CHECK":
        return { title: "Quality check and test ride", detail: "All repair tasks are finished.", action: latestQc?.result === "PENDING" ? <a href="#quality" className="text-[13px] text-brand-600 hover:underline">Continue QC ↓</a> : can(actor, "service.quality.inspect") ? <ActionButton size="sm" url={`/api/service/jobs/${job.id}/qc/start`} success="Quality inspection started.">Start QC</ActionButton> : undefined };
      case "FINAL_BILLING":
        if (!invoice) return { title: "Prepare the final invoice", detail: "Built from approved labour and the parts actually issued.", action: can(actor, "billing.manage") ? <ActionButton size="sm" url={`/api/service/jobs/${job.id}/invoice`} success="Draft invoice prepared.">Prepare invoice</ActionButton> : undefined };
        if (invoice.status === "DRAFT") return { title: "Check and finalize the invoice", action: can(actor, "billing.manage") ? <ActionButton size="sm" url={`/api/billing/invoices/${invoice.id}/finalize`} confirm="Finalize? It can't be edited afterwards." success="Invoice finalized.">Finalize invoice</ActionButton> : undefined };
        return { title: "Tell the customer the vehicle is ready", detail: Number(invoice.balanceDue) > 0 ? `Balance of ${fmtMoney(invoice.balanceDue)} to collect at pickup.` : "Invoice paid.", action: <a href="#delivery" className="text-[13px] text-brand-600 hover:underline">Ready for delivery ↓</a> };
      case "READY_FOR_DELIVERY":
        return { title: "Hand the vehicle over", tone: "ok", detail: <>Ready for {sinceText(job.readyAt)}.{invoice && Number(invoice.balanceDue) > 0 ? ` Collect ${fmtMoney(invoice.balanceDue)} first.` : ""}</>, action: <a href="#delivery" className="text-[13px] text-brand-600 hover:underline">Handover ↓</a> };
      case "DELIVERED":
      case "CLOSED":
        return { title: "Closed", tone: "muted", detail: `Delivered ${fmtDateTime(job.deliveredAt, tz)}.${full.feedback ? ` Customer rated ${full.feedback.rating}/5.` : " Feedback not received yet."}` };
      default:
        return { title: "Cancelled", tone: "muted", detail: job.cancelReason ?? undefined };
    }
  })();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <RegPlate reg={job.customerVehicle.registrationNumber} size="lg" />
            <h1 className="font-mono text-xl font-semibold sm:text-2xl">{job.jobNumber}</h1>
            <StatusBadge status={job.status} label={JOB_STATUS_LABEL[job.status]} />
            {job.isEmergency && <Badge tone="bad">Emergency</Badge>}
            <LiveRefresh jobId={job.id} />
          </div>
          <p className="mt-1 text-sm text-muted">{job.customerVehicle.modelName} · {job.customer.fullName} · {job.branch.name} · {titleCase(job.serviceType)} · received {fmtDateTime(job.receivedAt, tz)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {open && can(actor, "service.job.manage") && !job.customerAcknowledgedAt && <ActionButton variant="outline" size="sm" url={`/api/service/jobs/${job.id}/acknowledge`} success="Customer acknowledgement recorded.">Record customer acknowledgement</ActionButton>}
          {open && can(actor, "service.job.manage") && ["RECEIVED", "INSPECTION", "AWAITING_APPROVAL"].includes(job.status) && <CancelJob jobId={job.id} />}
        </div>
      </div>

      <StageBar status={job.status} held={shortages.length > 0 || job.status === "AWAITING_APPROVAL"} />
      <NextStep title={next.title} detail={next.detail} tone={next.tone}>{next.action}</NextStep>
      <SectionNav sections={[["job-card", "Job card"], ["inspection", "Inspection"], ["estimates", "Estimates", full.estimates.length], ["parts", "Parts", full.partRequests.length], ["tasks", "Tasks", liveTasks.length], ["quality", "Quality check"], ["billing", "Invoice"], ["delivery", "Handover"], ["timeline", "Customer view"], ["activity", "Activity"]]} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Card id="job-card" className="scroll-mt-24">
            <CardHeader title="Job card" description={job.customerAcknowledgedAt ? `Acknowledged by customer ${fmtDateTime(job.customerAcknowledgedAt, tz)}` : "Awaiting customer acknowledgement"} action={<Link href={`/customers/${job.customerId}`} className="text-xs font-medium text-brand-600">Customer profile →</Link>} />
            <CardBody className="grid gap-6 lg:grid-cols-2">
              <DL items={[
                [<span key="c" className="inline-flex items-center gap-1">Customer</span>, <>{job.customer.fullName}<div className="text-xs text-muted">{job.customer.phone}{job.customer.email ? ` · ${job.customer.email}` : ""}</div></>],
                [<span key="v" className="inline-flex items-center gap-1">Vehicle</span>, <>{job.customerVehicle.modelName}<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted"><RegPlate reg={job.customerVehicle.registrationNumber} />{job.customerVehicle.vin ? <span className="font-mono">{job.customerVehicle.vin}</span> : null}</div></>],
                [<span key="o" className="inline-flex items-center gap-1">Odometer / fuel</span>, `${job.odometerIn.toLocaleString("en-IN")} km · ${titleCase(job.fuelLevel)}`],
                ["Accessories received", job.accessoriesReceived.join(", ") || "None"],
              ]} />
              <DL className="sm:grid-cols-1" items={[["Reported problems", job.reportedProblems], ["Condition / existing damage", [job.vehicleCondition, job.existingDamage].filter(Boolean).join(" — ") || "—"]]} />
            </CardBody>
          </Card>

          <Card id="inspection" className="scroll-mt-24">
            <CardHeader title="Inspection & diagnosis" action={job.status === "RECEIVED" && can(actor, "service.inspect") ? <ActionButton size="sm" url={`/api/service/jobs/${job.id}/inspection/start`} success="Inspection started.">Start inspection</ActionButton> : undefined} />
            <CardBody className="space-y-4">
              {full.inspections.map((i) => (
                <div key={i.id} className="rounded-[3px] border border-line p-4 text-sm">
                  <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{i.examiner.name}</span><span className="text-xs text-muted">{fmtDateTime(i.startedAt, tz)} → {i.completedAt ? fmtDateTime(i.completedAt, tz) : "in progress"}</span></div>
                  {i.safetyCritical && <Badge tone="bad">safety-critical findings</Badge>}
                  {i.findings && <p className="mt-2"><span className="text-muted">Findings: </span>{i.findings}</p>}
                  {i.customerSummary && <p className="mt-1"><span className="text-muted">Customer summary: </span>{i.customerSummary}</p>}
                  {i.internalNotes && <p className="mt-1 rounded bg-warn-50 px-2 py-1 text-xs text-warn-700">Internal: {i.internalNotes}</p>}
                  {Array.isArray(i.checklist) && (i.checklist as { label: string; result: string }[]).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">{(i.checklist as { label: string; result: string }[]).map((c, k) => <Badge key={k} tone={c.result === "OK" ? "ok" : c.result === "FAIL" ? "bad" : c.result === "ATTENTION" ? "warn" : "neutral"}>{c.label}: {c.result.toLowerCase()}</Badge>)}</div>
                  )}
                </div>
              ))}
              {needInspectionData && job.status === "INSPECTION" && <InspectionForm jobId={job.id} items={itemOpts} durations={durOpts} model={job.customerVehicle.modelName} mode="inspection" />}
              {!full.inspections.length && job.status === "RECEIVED" && <p className="text-sm text-muted">Inspection not started.</p>}
            </CardBody>
          </Card>

          <Card id="estimates" className="scroll-mt-24">
            <CardHeader title="Estimates & customer approval" description={pendingApprovalTasks.length ? `${pendingApprovalTasks.length} task(s) awaiting approval — chargeable work cannot start until approved.` : undefined} />
            {full.estimates.length ? (
              <div className="divide-y divide-line">
                {full.estimates.map((e) => (
                  <div key={e.id} className="p-5">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2"><span className="font-mono text-sm font-medium">{e.estimateNumber}</span><Badge>{e.kind.toLowerCase()}</Badge><StatusBadge status={e.status} /></div>
                      <div className="flex gap-2">
                        {e.status === "DRAFT" && can(actor, "service.estimate.manage") && <SendEstimate estimateId={e.id} />}
                        {e.status === "SENT" && can(actor, "service.estimate.record_approval") && <DecisionRecorder estimateId={e.id} lines={e.lines.filter((l) => l.approvalStatus === "PENDING").map((l) => ({ id: l.id, description: l.description, type: l.type, total: Number(l.lineTotal), optional: l.isOptional }))} />}
                      </div>
                    </div>
                    <Table>
                      <thead><tr><Th>Item</Th><Th className="text-right">Qty</Th><Th className="text-right">Rate</Th><Th className="text-right">Disc.</Th><Th className="text-right">Tax</Th><Th className="text-right">Total</Th><Th>Decision</Th></tr></thead>
                      <tbody>
                        {e.lines.map((l) => (
                          <tr key={l.id}>
                            <Td>{l.description}<div className="text-xs text-muted">{l.type.toLowerCase()}{l.isOptional ? " · optional" : ""}</div></Td>
                            <Td className="text-right tabular-nums">{l.quantity}</Td>
                            <Td className="text-right tabular-nums">{fmtMoney(l.unitPrice)}</Td>
                            <Td className="text-right tabular-nums">{e.status === "DRAFT" && can(actor, "service.estimate.manage") ? <DiscountEditor lineId={l.id} value={Number(l.discount)} /> : fmtMoney(l.discount)}</Td>
                            <Td className="text-right tabular-nums">{fmtMoney(l.taxAmount)}</Td>
                            <Td className="text-right font-medium tabular-nums">{fmtMoney(l.lineTotal)}</Td>
                            <Td><StatusBadge status={l.approvalStatus} /></Td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr><Td colSpan={5} className="text-right text-xs text-muted">Labour {fmtMoney(e.labourTotal)} · Parts {fmtMoney(e.partsTotal)} · Discount {fmtMoney(e.discountTotal)} · Tax {fmtMoney(e.taxTotal)}</Td><Td className="text-right font-semibold">{fmtMoney(e.grandTotal)}</Td><Td className="text-xs text-muted">approved {fmtMoney(e.approvedTotal)}</Td></tr></tfoot>
                    </Table>
                    {e.approvals.length > 0 && <p className="mt-2 text-xs text-muted">Decision recorded {fmtDateTime(e.approvals.at(-1)!.decidedAt, tz)} via {e.approvals.at(-1)!.channel.toLowerCase().replace("_", " ")}.</p>}
                  </div>
                ))}
              </div>
            ) : <EmptyState title="No estimate yet" description="An estimate is created when the inspection is completed." />}
            {needSupplementary && (
              <CardBody className="border-t border-line">
                <InspectionForm jobId={job.id} items={itemOpts} durations={durOpts} model={job.customerVehicle.modelName} mode="supplementary" />
              </CardBody>
            )}
          </Card>

          <Card id="parts" className="scroll-mt-24">
            <CardHeader
              title="Spare parts"
              description="Required, reserved, issued and missing quantities for approved work"
              action={open && can(actor, "service.parts.request") && ["APPROVED", "PARTS_PENDING", "IN_REPAIR", "QUALITY_CHECK"].includes(job.status) ? <ActionButton size="sm" url={`/api/service/jobs/${job.id}/parts/verify`} success="Availability checked — parts reserved where in stock, shortages recorded.">Check availability & raise requests</ActionButton> : undefined}
            />
            {full.partRequests.length ? (
              <Table>
                <thead><tr><Th>Part</Th><Th className="text-right">Req.</Th><Th className="text-right">Avail. now</Th><Th>Status</Th><Th>Issued</Th><Th>Expected</Th><Th /></tr></thead>
                <tbody>
                  {full.partRequests.map((r) => {
                    const s = stock[r.itemId];
                    return (
                      <tr key={r.id}>
                        <Td>{r.item.name}<div className="text-xs text-muted">{r.item.partNumber} · {r.requestNumber}{r.repairTask ? ` · ${r.repairTask.title}` : ""}</div></Td>
                        <Td className="text-right tabular-nums">{r.quantity}</Td>
                        <Td className="text-right tabular-nums">{s ? s.onHand - s.reserved : 0}<div className="text-[11px] text-faint">{s ? `${s.onHand} on hand · ${s.reserved} reserved` : ""}</div></Td>
                        <Td><StatusBadge status={r.status} />{["UNAVAILABLE", "AWAITING_PROCUREMENT"].includes(r.status) && <div className="mt-1 text-xs text-bad-700">missing {r.quantity}</div>}</Td>
                        <Td className="text-xs">{r.issue ? <>{r.issue.quantity} by {r.issue.issuedBy.name}<br />to {r.issue.receivedBy.name}<br />{fmtDateTime(r.issue.issuedAt, tz)}</> : "—"}</Td>
                        <Td className="text-xs">{r.expectedAvailableAt ? fmtDateTime(r.expectedAvailableAt, tz) : ["UNAVAILABLE", "AWAITING_PROCUREMENT"].includes(r.status) ? <span className="text-bad-700">not recorded</span> : "—"}{r.procurementNote && <div className="text-muted">{r.procurementNote}</div>}</Td>
                        <Td>{["UNAVAILABLE", "AWAITING_PROCUREMENT"].includes(r.status) && (can(actor, "inventory.manage") || can(actor, "service.job.manage")) && <ProcurementForm requestId={r.id} />}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : <EmptyState title="No part requests" description="After approval, check availability to reserve parts and notify the warehouse." />}
          </Card>

          <Card id="tasks" className="scroll-mt-24">
            <CardHeader title="Repair tasks" description="PENDING → READY → IN PROGRESS → PAUSED / BLOCKED → COMPLETED. Tasks run in parallel when dependencies allow." />
            {full.tasks.length ? (
              <ul className="divide-y divide-line">
                {full.tasks.map((t) => (
                  <li key={t.id} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{t.title}</p>
                          <StatusBadge status={t.status} />
                          {t.origin !== "INITIAL" && <Badge tone="brand">{t.origin.toLowerCase().replace("_", " ")}</Badge>}
                          {t.isSafetyCritical && <Badge tone="bad">safety</Badge>}
                          {t.requiresApproval && !t.approved && t.status !== "CANCELLED" && <Badge tone="warn">awaiting approval</Badge>}
                          {t.reworkCount > 0 && <Badge tone="warn">rework ×{t.reworkCount}</Badge>}
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          {t.assignedMechanic ? `${t.assignedMechanic.name}${t.assignedMechanic.employee ? ` (${t.assignedMechanic.employee.employeeCode})` : ""}` : "Unassigned"} · est. {fmtMinutes(t.estimatedMinMinutes)}–{fmtMinutes(t.estimatedMaxMinutes)} · worked {fmtMinutes(t.workedMinutes)}
                          {t.startedAt && ` · started ${fmtDateTime(t.startedAt, tz)}`}{t.completedAt && ` · done ${fmtDateTime(t.completedAt, tz)}`}
                        </p>
                        {t.dependencies.length > 0 && <p className="text-xs text-muted">After: {t.dependencies.map((d) => d.dependsOn.title).join(", ")}</p>}
                        {t.holdReason && <p className="mt-1 inline-flex items-center gap-1 text-xs text-warn-700">{t.holdReason}</p>}
                      </div>
                      {t.status !== "CANCELLED" && <TaskActions task={{ id: t.id, status: t.status, version: t.version, mechanicId: t.assignedMechanicId, holdReason: t.holdReason }} mechanics={mechanics} canAssign={can(actor, "service.repair.assign")} isMine={t.assignedMechanicId === actor.userId} canWork={can(actor, "service.repair.work")} />}
                    </div>
                    {t.workLogs.length > 0 && (
                      <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer select-none">Transition history ({t.workLogs.length})</summary>
                        <ul className="mt-1 space-y-0.5">{t.workLogs.map((w) => <li key={w.id}>{fmtDateTime(w.createdAt, tz)} — {w.mechanic.name}: {w.fromStatus.toLowerCase()} → {w.toStatus.toLowerCase()}{w.reason ? ` (${w.reason})` : ""}{w.minutesWorked ? ` · ${w.minutesWorked} min` : ""}</li>)}</ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No repair tasks yet" />}
          </Card>

          <Card id="quality" className="scroll-mt-24">
            <CardHeader title="Quality inspection & test ride" action={job.status === "QUALITY_CHECK" && can(actor, "service.quality.inspect") && (!latestQc || latestQc.result !== "PENDING") ? <ActionButton size="sm" url={`/api/service/jobs/${job.id}/qc/start`} success="Quality inspection started.">Start QC</ActionButton> : undefined} />
            {full.qualityInspections.length ? (
              <div className="divide-y divide-line">
                {full.qualityInspections.map((q) => (
                  <div key={q.id} className="space-y-3 p-5 text-sm">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{q.inspector.name}</span><StatusBadge status={q.result} /><span className="text-xs text-muted">{fmtDateTime(q.startedAt, tz)}{q.completedAt ? ` → ${fmtDateTime(q.completedAt, tz)}` : ""}</span></div>
                    {q.failureReason && <p className="text-bad-700">Failed: {q.failureReason}</p>}
                    {q.testRides.map((r) => (
                      <div key={r.id} className="rounded-[3px] bg-canvas px-3 py-2 text-xs">
                        Test ride by {r.rider.name}: {fmtDateTime(r.startedAt, tz)}{r.endedAt ? ` → ${fmtDateTime(r.endedAt, tz)}` : " (in progress)"} · odometer {r.odometerStart}{r.odometerEnd ? ` → ${r.odometerEnd} km` : ""} · <StatusBadge status={r.result} />{r.observations && <p className="mt-1 text-ink">{r.observations}</p>}
                        {!r.endedAt && can(actor, "service.quality.inspect") && <div className="mt-2"><TestRideEnd rideId={r.id} odometerStart={r.odometerStart} /></div>}
                      </div>
                    ))}
                    {q.result === "PENDING" && can(actor, "service.quality.inspect") && (
                      <div className="space-y-3">
                        {!q.testRides.some((r) => !r.endedAt) && <TestRideStart qcId={q.id} odometer={job.odometerIn} />}
                        <QcCompleteForm qcId={q.id} checklist={q.checklist as { key: string; label: string; mandatory: boolean; safetyCritical: boolean }[]} tasks={liveTasks.filter((t) => t.status === "COMPLETED").map((t) => ({ id: t.id, title: t.title }))} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : <EmptyState title="Not started" description="Quality inspection begins when every repair task is complete." />}
          </Card>

          <Card id="billing" className="scroll-mt-24">
            <CardHeader
              title="Final invoice & payments"
              action={
                <div className="flex gap-2">
                  {job.status === "FINAL_BILLING" && can(actor, "billing.manage") && (!invoice || invoice.status === "DRAFT") && <ActionButton size="sm" variant="outline" url={`/api/service/jobs/${job.id}/invoice`} success="Draft invoice prepared from approved work and issued parts.">{invoice ? "Rebuild draft" : "Prepare invoice"}</ActionButton>}
                  {invoice?.status === "DRAFT" && can(actor, "billing.manage") && <ActionButton size="sm" url={`/api/billing/invoices/${invoice.id}/finalize`} confirm="Finalize this invoice? Finalized invoices cannot be edited — corrections need a credit note." success="Invoice finalized.">Finalize</ActionButton>}
                  {invoice && <Link href={`/billing/${invoice.id}`} className="inline-flex h-8 items-center rounded-[3px] border border-line px-3 text-xs font-medium hover:bg-canvas">Open</Link>}
                </div>
              }
            />
            {invoice ? (
              <CardBody className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-3"><span className="font-mono">{invoice.invoiceNumber ?? "Draft"}</span><StatusBadge status={invoice.status} /><span>Total <b>{fmtMoney(invoice.grandTotal)}</b></span><span>Paid {fmtMoney(invoice.amountPaid)}</span><span className={Number(invoice.balanceDue) > 0 ? "font-medium text-warn-700" : "text-ok-700"}>Balance {fmtMoney(invoice.balanceDue)}</span></div>
                <p className="text-xs text-muted">{invoice.lines.length} line(s): labour for completed approved tasks and parts actually issued.</p>
                {invoice.payments.length > 0 && (
                  <ul className="space-y-1 text-xs">{invoice.payments.map((p) => <li key={p.id} className="flex flex-wrap items-center gap-2"><StatusBadge status={p.status} /> {fmtMoney(p.amount)} · {p.method.toLowerCase()}{p.reference ? ` · ${p.reference}` : ""}{p.receiptNumber ? ` · ${p.receiptNumber}` : ""}{p.status === "PENDING_CONFIRMATION" && can(actor, "payments.confirm") && <ActionButton size="sm" variant="success" url={`/api/payments/${p.id}/confirm`} success="Payment confirmed; receipt issued.">Confirm</ActionButton>}</li>)}</ul>
                )}
                {["FINALIZED", "PARTIALLY_PAID"].includes(invoice.status) && can(actor, "payments.record") && <PaymentForm invoiceId={invoice.id} balance={Number(invoice.balanceDue)} canConfirm={can(actor, "payments.confirm")} />}
              </CardBody>
            ) : <EmptyState title="No invoice yet" description="Prepared after the quality inspection passes." />}
          </Card>

          <Card id="delivery" className="scroll-mt-24">
            <CardHeader title="Ready for delivery & handover" />
            <CardBody className="space-y-3 text-sm">
              {job.status === "FINAL_BILLING" && can(actor, "service.handover") && <ReadyForm jobId={job.id} />}
              {job.status === "READY_FOR_DELIVERY" && can(actor, "service.handover") && <HandoverForm jobId={job.id} odometer={job.odometerIn} balance={invoice ? Number(invoice.balanceDue) : 0} />}
              {full.handover && (
                <DL items={[["Handed over by", activity.find((a) => a.action === "job.delivered")?.actorName ?? "—"], ["Recipient", `${full.handover.recipientName} (${full.handover.recipientRelation.toLowerCase().replace("_", " ")})`], ["Time", fmtDateTime(full.handover.handedOverAt, tz)], ["Final odometer", `${full.handover.odometerOut} km`], ["Customer acknowledged", full.handover.customerAcknowledged ? "Yes" : "No"], ["Notes", full.handover.notes ?? "—"]]} />
              )}
              {!["FINAL_BILLING", "READY_FOR_DELIVERY"].includes(job.status) && !full.handover && <p className="text-muted">Available after quality checks and final billing.</p>}
              {full.feedback && <Notice tone={full.feedback.rating >= 4 ? "ok" : "warn"} title={`Customer feedback: ${full.feedback.rating}/5`}>{full.feedback.comments ?? "No comments."}</Notice>}
              {full.followUps.length > 0 && (
                <div><p className="mb-1 text-xs font-medium text-muted">Follow-ups</p><ul className="space-y-1 text-xs">{full.followUps.map((f) => <li key={f.id}>{titleCase(f.type)} · due {fmtDateTime(f.dueAt, tz)} · <StatusBadge status={f.status} />{f.outcome ? ` · ${f.outcome}` : ""}</li>)}</ul></div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Right rail */}
        <div className="space-y-6">
          <EtaPanel eta={{ earliest: job.etaEarliest, latest: job.etaLatest, confidence: job.etaConfidence, updatedAt: job.etaUpdatedAt, reason: breakdown.reason, initialEstimate: job.expectedCompletionAt }} tz={tz} status={job.status} partsDelayed={shortages.length > 0} />
          {breakdown.activeMinutes && open && (
            <Card><CardBody className="grid grid-cols-2 gap-3 text-xs">
              <div><p className="text-muted">Active work left</p><p className="font-medium">{fmtMinutes(breakdown.activeMinutes.min)}–{fmtMinutes(breakdown.activeMinutes.max)}</p></div>
              <div><p className="text-muted">Queue time</p><p className="font-medium">{fmtMinutes(breakdown.queueMinutes?.min)}–{fmtMinutes(breakdown.queueMinutes?.max)}</p></div>
              <div><p className="text-muted">Parts wait</p><p className="font-medium">{fmtMinutes(breakdown.partsWaitMinutes ?? 0)}</p></div>
              <div><p className="text-muted">Elapsed since intake</p><p className="font-medium">{fmtElapsed(Math.max(0, Math.round((Date.now() - new Date(job.receivedAt).getTime()) / 60_000)))}</p></div>
            </CardBody></Card>
          )}
          <Card>
            <CardHeader title="People on this job" />
            <CardBody className="space-y-3 text-sm">
              <ul className="space-y-1.5">{full.assignments.map((a) => <li key={a.id} className="flex justify-between gap-2"><span>{a.user.name}{a.user.employee && <span className="text-xs text-faint"> · {a.user.employee.employeeCode}</span>}</span><Badge>{a.role.toLowerCase()}</Badge></li>)}</ul>
              <p className="flex items-center gap-1 text-xs text-muted">Branch: {job.branch.phone ?? "—"}</p>
              {open && (can(actor, "service.job.manage") || can(actor, "service.repair.assign")) && <AssignStaff jobId={job.id} staff={staff.map((s) => ({ id: s.id, name: s.name, roles: s.roles.map((r) => r.role.key) }))} canManage={can(actor, "service.job.manage")} />}
            </CardBody>
          </Card>
          <Card id="timeline" className="scroll-mt-24">
            <CardHeader title="Customer timeline" description="Exactly what the customer sees in their portal" />
            <CardBody><ServiceTimeline stages={stages} events={events} tz={tz} /></CardBody>
          </Card>
          <Card>
            <CardHeader title="Photos" />
            <CardBody className="space-y-3">
              <p className="text-xs text-muted">{full.photos.length} photo(s) on file. Downloads use short-lived signed links.</p>
              {open && <PhotoUpload jobId={job.id} branchId={job.branchId} photoIds={full.photos.map((p) => ({ fileId: p.fileId, stage: p.stage, caption: p.caption, visible: p.customerVisible }))} />}
            </CardBody>
          </Card>
          <Card id="activity" className="scroll-mt-24">
            <CardHeader title="Internal activity" description="Staff only — never shown to customers" />
            <ul className="max-h-96 divide-y divide-line overflow-y-auto text-xs">
              {activity.map((a) => <li key={a.id} className="px-5 py-2"><span className="font-medium">{a.actorName}</span> <span className="text-muted">{a.action.replace(/[._]/g, " ")}</span><div className="text-faint">{fmtDateTime(a.createdAt, tz)}</div></li>)}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
