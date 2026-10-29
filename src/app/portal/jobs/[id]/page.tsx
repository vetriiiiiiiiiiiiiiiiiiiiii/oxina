import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCustomerPage } from "@/lib/auth/current";
import { AppError } from "@/lib/errors";
import { customerJobView, type CustomerJobView } from "@/lib/services/service/delivery";
import { PART_UNAVAILABLE_CUSTOMER_MESSAGE, JOB_STATUS_LABEL } from "@/lib/service/stages";
import { Card, CardBody, CardHeader, Notice, StatusBadge } from "@/components/ui";
import { EtaPanel, ServiceTimeline } from "@/components/service/timeline";
import { LiveRefresh } from "@/components/forms/live-refresh";
import { ActionButton } from "@/components/forms/action-button";
import { cn, fmtDate, fmtDateTime, fmtMinutes, fmtMoney, fmtTime, titleCase } from "@/lib/utils";
import { EstimateApproval, FeedbackForm, PhotoLink } from "./client";
import { RegPlate } from "@/components/visual/plate";
import { StepTracker } from "@/components/visual/steps";

export const metadata = { title: "Your service" };

const CHECK: Record<string, { label: string; cls: string }> = {
  OK: { label: "OK", cls: "text-ok-700" },
  ATTENTION: { label: "Needs attention", cls: "text-warn-700" },
  FAIL: { label: "Problem found", cls: "text-bad-700" },
  NA: { label: "Not checked", cls: "text-faint" },
};

const STATE_CLS: Record<string, string> = {
  done: "text-ok-700 bg-ok-50",
  working: "text-navy-900 bg-brand-100",
  parts: "text-bad-700 bg-bad-50",
  hold: "text-warn-700 bg-warn-50",
  paused: "text-warn-700 bg-warn-50",
  next: "text-brand-700 bg-brand-50",
  scheduled: "text-muted bg-[#efeee9]",
};
const STATE_EDGE: Record<string, string> = {
  done: "var(--color-dept-money)",
  working: "var(--color-navy-900)",
  parts: "var(--color-dept-showroom)",
  hold: "var(--color-dept-parts)",
  paused: "var(--color-dept-parts)",
  next: "var(--color-dept-workshop)",
  scheduled: "#c9c5bb",
};
const PART_CLS: Record<string, string> = {
  issued: "text-ok-700 bg-ok-50",
  reserved: "text-brand-700 bg-brand-50",
  checking: "text-muted bg-[#efeee9]",
  ordered: "text-warn-700 bg-warn-50",
  ordering: "text-warn-700 bg-warn-50",
  late: "text-bad-700 bg-bad-50",
};

function Section({ n, title, children, id }: { n: number; title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-16">
      <h2 className="mb-2 flex items-baseline gap-2 text-[15px] font-semibold">
        <span className="font-mono text-[12px] font-normal text-faint">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function PortalJob({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireCustomerPage();
  const { id } = await params;
  const v = await customerJobView(actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const tz = v.branch.timezone;
  const pending = v.estimates.find((e) => e.status === "SENT");
  const closed = ["DELIVERED", "CLOSED", "CANCELLED"].includes(v.status);
  let n = 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/portal" className="text-[13px] text-brand-600 hover:underline">← Your vehicles</Link>
        <Card className="mt-2 overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-2 border-b-[3px] border-navy-900 px-4 py-3">
            <div className="min-w-0">
              <h1 className="text-[21px] font-semibold leading-tight">{v.vehicle.modelName}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-muted"><RegPlate reg={v.vehicle.registrationNumber} size="md" /> <span>Job {v.jobNumber}</span></div>
            </div>
            <div className="text-right">
              <StatusBadge status={v.status} label={JOB_STATUS_LABEL[v.status]} />
              {!closed && <div className="mt-1"><LiveRefresh jobId={v.id} /></div>}
            </div>
          </div>
          <div className="px-3 pb-3 pt-4">
            <StepTracker status={v.status} held={v.partsDelayed || v.status === "AWAITING_APPROVAL"} />
          </div>
          <p className="border-t border-line bg-shade px-4 py-1.5 text-[12px] text-muted">In since {fmtDateTime(v.receivedAt, tz)} · {v.branch.name}</p>
        </Card>
      </div>

      {/* 1. What we need from you */}
      {v.needsYou.length > 0 && (
        <Section n={++n} title="What we need from you">
          <div className="space-y-3">
            <ul className="border border-line border-l-[3px] border-l-warn-600 bg-white">
              {v.needsYou.map((x) => (
                <li key={x.key} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5 last:border-0">
                  <div>
                    <p className="text-sm font-medium">{x.title}</p>
                    <p className="text-[13px] text-muted">{x.detail}</p>
                  </div>
                  {x.key === "acknowledge" && <ActionButton size="sm" url={`/api/service/jobs/${v.id}/acknowledge`} success="Thank you — job card confirmed.">Confirm</ActionButton>}
                </li>
              ))}
            </ul>
            {pending && <EstimateApproval estimate={JSON.parse(JSON.stringify(pending))} proposed={v.proposed} />}
            {v.needsYou.some((x) => x.key === "feedback") && <FeedbackForm jobId={v.id} />}
          </div>
        </Section>
      )}

      {/* 2. When it will be ready */}
      <Section n={++n} title="When it will be ready">
        <div className="space-y-3">
          <EtaPanel eta={v.eta} tz={tz} status={v.status} partsDelayed={v.partsDelayed} />
          {!closed && <TimeFacts v={v} />}
          {v.time.changes.length > 0 && (
            <Card>
              <CardHeader title="Changes to the completion time" description="Every time the expected time moved, and what caused it." />
              <ul className="text-[13px]">
                {v.time.changes.map((c, i) => (
                  <li key={i} className="border-b border-line px-4 py-2 last:border-0">
                    <p><span className="text-muted">{c.from ? fmtDateTime(c.from, tz) : "Not set"}</span> → <b className="font-medium">{c.to ? fmtDateTime(c.to, tz) : "To be confirmed"}</b></p>
                    <p className="text-muted">{c.why} · {fmtDateTime(c.at, tz)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </Section>

      {/* 3. What we found */}
      <Section n={++n} title="What we found">
        {v.found ? (
          <Card>
            <CardBody className="space-y-3">
              {v.found.summary && <p className="text-sm">{v.found.summary}</p>}
              {v.found.safety && <Notice tone="bad">Some findings affect riding safety. Your advisor will explain them.</Notice>}
              {v.found.checks.length > 0 && (
                <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                  {v.found.checks.map((c, i) => (
                    <div key={i} className="flex justify-between gap-3 border-b border-line py-1.5 text-[13px]">
                      <dt>{c.label}</dt>
                      <dd className={CHECK[c.result]?.cls ?? ""}>{CHECK[c.result]?.label ?? c.result}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="text-[12px] text-faint">Inspected{v.found.by ? ` by ${v.found.by}` : ""} · {fmtDateTime(v.found.at, tz)}</p>
            </CardBody>
          </Card>
        ) : (
          <p className="text-[13px] text-muted">A technician will inspect your vehicle. The findings will appear here.</p>
        )}
      </Section>

      {/* 4. What we are changing */}
      <Section n={++n} title="What we're doing to your vehicle">
        {v.repairs.length ? (
          <div className="space-y-2.5">
            {v.repairs.map((r) => <RepairCard key={r.id} r={r} tz={tz} />)}
            {v.declined.length > 0 && <p className="text-[13px] text-muted">You chose not to go ahead with: {v.declined.map((d) => d.title).join(", ")}.</p>}
            {v.partsDelayed && <Notice tone="warn">{PART_UNAVAILABLE_CUSTOMER_MESSAGE}</Notice>}
          </div>
        ) : (
          <p className="text-[13px] text-muted">{pending ? "Repairs will be listed here once you approve the estimate." : "Repairs will be listed here after the inspection."}</p>
        )}
      </Section>

      {/* 5. Cost */}
      <Section n={++n} title="Cost">
        <Card>
          <dl className="text-sm">
            <div className="flex justify-between border-b border-line px-4 py-2"><dt className="text-muted">Work you’ve approved (incl. tax)</dt><dd className="font-mono">{fmtMoney(v.costs.approved)}</dd></div>
            {v.costs.awaitingDecision > 0 && <div className="flex justify-between border-b border-line px-4 py-2"><dt className="text-muted">Waiting for your decision</dt><dd className="font-mono text-warn-700">{fmtMoney(v.costs.awaitingDecision)}</dd></div>}
            {v.invoice ? (
              <>
                <div className="flex justify-between border-b border-line px-4 py-2"><dt>Final invoice <Link href={`/portal/invoices/${v.invoice.id}`} className="font-mono text-[13px] text-brand-600 hover:underline">{v.invoice.invoiceNumber}</Link></dt><dd className="font-mono font-medium">{fmtMoney(v.invoice.grandTotal)}</dd></div>
                <div className="flex justify-between border-b border-line px-4 py-2"><dt className="text-muted">Paid</dt><dd className="font-mono">{fmtMoney(v.invoice.amountPaid)}</dd></div>
                <div className="flex justify-between px-4 py-2"><dt>Balance</dt><dd className={cn("font-mono", Number(v.invoice.balanceDue) > 0 ? "text-warn-700" : "text-ok-700")}>{fmtMoney(v.invoice.balanceDue)}</dd></div>
              </>
            ) : (
              <p className="px-4 py-2 text-[13px] text-muted">The final invoice is made after the quality check, from the work actually done and the parts actually fitted. It will not exceed what you approved unless you approve more.</p>
            )}
          </dl>
        </Card>
      </Section>

      {/* 6. Full log */}
      <Section n={++n} title="Everything that has happened">
        <Card><CardBody><ServiceTimeline stages={v.stages} events={v.events} tz={tz} /></CardBody></Card>
      </Section>

      {/* 7. Reception record */}
      <Section n={++n} title="What we recorded when you dropped it off">
        <Card>
          <CardBody className="grid gap-3 text-[13px] sm:grid-cols-2">
            <div><p className="text-muted">Problems you told us about</p><p>{v.reportedProblems}</p></div>
            <div><p className="text-muted">Odometer · fuel</p><p className="font-mono">{v.vehicle.odometerIn.toLocaleString("en-IN")} km · {titleCase(v.vehicle.fuelLevel)}</p></div>
            <div><p className="text-muted">Existing marks or damage</p><p>{v.existingDamage || "None noted"}</p></div>
            <div><p className="text-muted">Items left with the vehicle</p><p>{v.accessoriesReceived.length ? v.accessoriesReceived.join(", ") : "None"}</p></div>
            <p className="text-faint sm:col-span-2">{v.acknowledgedAt ? `You confirmed these details on ${fmtDateTime(v.acknowledgedAt, tz)}.` : "Not confirmed yet."}</p>
          </CardBody>
        </Card>
      </Section>

      {v.photos.length > 0 && (
        <Section n={++n} title="Photos">
          <div className="flex flex-wrap gap-2">{v.photos.map((p) => <PhotoLink key={p.id} fileId={p.fileId} label={p.caption ?? p.stage.toLowerCase()} />)}</div>
        </Section>
      )}

      {v.feedback && <Notice tone="ok" title={`Your rating: ${v.feedback.rating}/5`}>{v.feedback.comments ?? "Thank you."}</Notice>}

      <Card>
        <CardBody className="text-[13px]">
          <p className="font-medium">{v.branch.name}</p>
          {v.branch.address && <p className="text-muted">{v.branch.address}</p>}
          <p className="text-muted">Service advisor {v.advisor.name}{v.advisor.phone ? ` · ${v.advisor.phone}` : ""}</p>
        </CardBody>
      </Card>
    </div>
  );
}

function TimeFacts({ v }: { v: CustomerJobView }) {
  const t = v.time;
  const pct = t.repairsTotal ? Math.round((t.repairsDone / t.repairsTotal) * 100) : 0;
  return (
    <Card>
      <CardBody className="space-y-3 text-[13px]">
        {t.repairsTotal > 0 && (
          <div>
            <div className="mb-1 flex justify-between"><span>Repairs finished</span><span className="font-mono">{t.repairsDone} of {t.repairsTotal}</span></div>
            <div className="h-2.5 rounded-[2px] bg-line/70"><div className="h-2.5 rounded-[2px] bg-ok-600" style={{ width: `${pct}%` }} /></div>
          </div>
        )}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {t.workLeft && <div className="flex justify-between gap-3"><dt className="text-muted">Hands-on work left, incl. checks</dt><dd className="font-mono">{t.workLeft.min === t.workLeft.max ? fmtMinutes(t.workLeft.min) : `${fmtMinutes(t.workLeft.min)}–${fmtMinutes(t.workLeft.max)}`}</dd></div>}

          {t.queue && t.queue.max > 0 && <div className="flex justify-between gap-3"><dt className="text-muted">Technician finishing other work first</dt><dd className="font-mono">up to {fmtMinutes(t.queue.max)}</dd></div>}
        </dl>
        <div>
          <p className="mb-1 text-muted">After the repairs</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {t.afterRepairs.map((s) => <li key={s.label} className={s.done ? "text-ok-700" : "text-muted"}>{s.done ? "✓" : "○"} {s.label}</li>)}
          </ul>
        </div>
        {v.waitingOn.length > 0 && (
          <div>
            <p className="mb-1 text-muted">We’re waiting for</p>
            <ul>{v.waitingOn.map((w, i) => <li key={i}>{w.title}<br /><span className={w.late ? "text-bad-700" : "text-warn-700"}>{w.detail}{w.expected ? ` (expected ${fmtDateTime(w.expected, v.branch.timezone)})` : ""}</span></li>)}</ul>
          </div>
        )}
        <p className="text-[12px] text-faint">Times are for workshop hours only and are recalculated whenever something changes.</p>
      </CardBody>
    </Card>
  );
}

function RepairCard({ r, tz }: { r: CustomerJobView["repairs"][number]; tz: string }) {
  const est = r.time.estimateMin === r.time.estimateMax ? fmtMinutes(r.time.estimateMin) : `${fmtMinutes(r.time.estimateMin)}–${fmtMinutes(r.time.estimateMax)}`;
  return (
    <Card className="border-l-[4px]" style={{ borderLeftColor: STATE_EDGE[r.state.key] ?? "#c9c5bb" }}>
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">{r.title}</p>
          <p className={cn("rounded-[2px] px-1.5 py-[1px] text-[12.5px] font-medium", STATE_CLS[r.state.key] ?? "")}>{r.state.label}</p>
        </div>
        {(r.safety || r.addedLater || r.redoneAfterCheck) && (
          <p className="mt-0.5 text-[12px] text-muted">
            {[r.safety && "Affects riding safety", r.addedLater && "Found during the service — added with your approval", r.redoneAfterCheck && "Re-checked and corrected after the quality check"].filter(Boolean).join(" · ")}
          </p>
        )}
        {r.why && <p className="mt-1 text-[13px]">{r.why}</p>}

        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
          <div className="flex justify-between gap-3"><dt className="text-muted">Usually takes</dt><dd className="font-mono">{est}</dd></div>
          {r.technician && <div className="flex justify-between gap-3"><dt className="text-muted">Technician</dt><dd>{r.technician}</dd></div>}
          {r.time.startedAt && <div className="flex justify-between gap-3"><dt className="text-muted">Started</dt><dd className="font-mono">{fmtDate(r.time.startedAt, tz) === fmtDate(new Date(), tz) ? fmtTime(r.time.startedAt, tz) : fmtDateTime(r.time.startedAt, tz)}</dd></div>}
          {r.time.finishedAt ? (
            <div className="flex justify-between gap-3"><dt className="text-muted">Finished</dt><dd className="font-mono">{fmtDateTime(r.time.finishedAt, tz)} <span className="text-muted">({fmtMinutes(r.time.spent)})</span></dd></div>
          ) : r.time.spent > 0 ? (
            <div className="flex justify-between gap-3"><dt className="text-muted">Time spent so far</dt><dd className="font-mono">{fmtMinutes(r.time.spent)}</dd></div>
          ) : null}
        </dl>

        {r.parts.length > 0 && (
          <div className="mt-2">
            <p className="text-[12px] text-muted">Parts being fitted</p>
            <ul className="mt-0.5 text-[13px]">
              {r.parts.map((p, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-x-3 border-b border-line py-1 last:border-0">
                  <span>{p.name} <span className="text-muted">× {p.quantity}</span></span>
                  <span className={cn("rounded-[2px] px-1.5 text-[12px]", PART_CLS[p.key] ?? "text-muted")}>
                    {p.label}{p.expected ? ` — ${p.key === "late" ? "was due" : "expected"} ${fmtDateTime(p.expected, tz)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {r.price > 0 && <p className="mt-2 text-right text-[13px]"><span className="text-muted">Approved price </span><span className="font-mono">{fmtMoney(r.price)}</span></p>}
      </div>
    </Card>
  );
}
