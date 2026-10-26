import { cn, fmtDateTime } from "@/lib/utils";

type Stage = { key: string; label: string; state: string; startedAt: Date | string | null; updatedAt: Date | string | null; title: string | null };
type Ev = { id: string; stage: string; state: string; title: string; note?: string | null; customerNote?: string | null; actorName: string | null; actorRole: string | null; next?: string | null; nextExpectedAction?: string | null; at?: Date | string; occurredAt?: Date | string };

const STATE: Record<string, { mark: string; label: string; text: string; tag?: string }> = {
  COMPLETED: { mark: "bg-ok-600 border-ok-600", label: "text-ink", text: "Done" },
  ACTIVE: { mark: "bg-white border-navy-900 border-[3px]", label: "text-ink font-semibold", text: "Now", tag: "text-navy-900" },
  BLOCKED: { mark: "bg-warn-600 border-warn-600", label: "text-warn-700 font-semibold", text: "Waiting", tag: "text-warn-700" },
  FAILED: { mark: "bg-bad-600 border-bad-600", label: "text-bad-700 font-semibold", text: "Needs attention", tag: "text-bad-700" },
  PENDING: { mark: "bg-white border-line-strong", label: "text-faint", text: "" },
};

/** Stage-by-stage progress with the events recorded under each stage. */
export function ServiceTimeline({ stages, events, tz, compact = false }: { stages: Stage[]; events: Ev[]; tz: string; compact?: boolean }) {
  const byStage = new Map<string, Ev[]>();
  for (const e of events) byStage.set(e.stage, [...(byStage.get(e.stage) ?? []), e]);
  return (
    <ol>
      {stages.map((s, i) => {
        const st = STATE[s.state] ?? STATE.PENDING;
        const evs = byStage.get(s.key) ?? [];
        const last = i === stages.length - 1;
        return (
          <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
            {!last && <span className={cn("absolute left-[5px] top-4 bottom-0 w-px", s.state === "COMPLETED" ? "bg-ok-600/60" : "bg-line-strong")} aria-hidden />}
            <span className={cn("relative z-10 mt-[5px] size-[11px] shrink-0 border-2", st.mark)} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className={cn("text-sm", st.label)}>
                  {s.label}
                  {st.tag && <span className={cn("ml-2 text-[12px] font-normal", st.tag)}>{st.text}</span>}
                </p>
                {s.updatedAt && <time className="font-mono text-[12px] text-muted">{fmtDateTime(s.updatedAt, tz)}</time>}
              </div>
              {!compact && evs.length > 0 && (
                <ul className="mt-1 space-y-1.5 border-l border-line pl-3">
                  {evs.map((e) => {
                    const note = e.note ?? e.customerNote;
                    const next = e.next ?? e.nextExpectedAction;
                    return (
                      <li key={e.id} className="text-[13px]">
                        <p className="text-ink">{e.title}<span className="ml-2 font-mono text-[11px] text-faint">{fmtDateTime(e.at ?? e.occurredAt ?? null, tz)}</span></p>
                        {(e.actorName || e.actorRole) && <p className="text-[12px] text-muted">{[e.actorName, e.actorRole].filter(Boolean).join(", ")}</p>}
                        {note && <p className="text-muted">{note}</p>}
                        {next && <p className="text-[12px] text-navy-700">Next: {next}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const CONFIDENCE: Record<string, string> = { FIRM: "firm", RANGE: "estimated range", PROVISIONAL: "provisional", UNKNOWN: "not yet available" };

export function EtaPanel({ eta, tz, status, partsDelayed }: {
  eta: { earliest: Date | string | null; latest: Date | string | null; confidence: string | null; updatedAt: Date | string | null; reason?: string | null; initialEstimate?: Date | string | null };
  tz: string;
  status: string;
  partsDelayed?: boolean;
}) {
  const done = ["READY_FOR_DELIVERY", "DELIVERED", "CLOSED", "CANCELLED"].includes(status);
  const a = eta.latest ? fmtDateTime(eta.earliest, tz) : null;
  const b = eta.latest ? fmtDateTime(eta.latest, tz) : null;
  return (
    <div className="border border-line border-l-[3px] border-l-navy-900 bg-white px-4 py-3">
      <p className="text-[12px] text-muted">Expected completion{!done && eta.confidence ? ` (${CONFIDENCE[eta.confidence] ?? eta.confidence.toLowerCase()})` : ""}</p>
      {done ? (
        <p className="mt-0.5 text-[17px] font-semibold">{status === "READY_FOR_DELIVERY" ? "Ready for collection" : status === "CANCELLED" ? "Cancelled" : "Completed"}</p>
      ) : b ? (
        <p className="mt-0.5 font-mono text-[16px] font-medium leading-snug">{a === b ? b : <>{a}<span className="font-sans font-normal text-muted"> to </span>{b}</>}</p>
      ) : (
        <p className="mt-0.5 text-[16px] font-semibold">To be confirmed</p>
      )}
      {!done && partsDelayed && <p className="mt-1 text-[13px] text-warn-700">Waiting for spare parts.</p>}
      {!done && eta.reason && <p className="mt-1 text-[13px] text-muted">{eta.reason}</p>}
      {!done && !eta.latest && eta.initialEstimate && <p className="mt-1 text-[13px] text-muted">Estimate given at reception: {fmtDateTime(eta.initialEstimate, tz)}</p>}
      {eta.updatedAt && !done && <p className="mt-2 text-[12px] text-faint">Last recalculated {fmtDateTime(eta.updatedAt, tz)}</p>}
    </div>
  );
}
