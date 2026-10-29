import { cn } from "@/lib/utils";

const STEPS = ["Received", "Inspected", "Approved", "Repairing", "Checked", "Billed", "Ready", "Delivered"];
const STEP_OF: Record<string, number> = {
  RECEIVED: 0, INSPECTION: 0, AWAITING_APPROVAL: 1, APPROVED: 2, PARTS_PENDING: 3, IN_REPAIR: 3,
  QUALITY_CHECK: 4, FINAL_BILLING: 5, READY_FOR_DELIVERY: 6, DELIVERED: 7, CLOSED: 7,
};

/** Customer-facing step tracker: dots on a line, done / current / still to come. */
export function StepTracker({ status, held, compact = false }: { status: string; held?: boolean; compact?: boolean }) {
  if (status === "CANCELLED") return null;
  const cur = STEP_OF[status] ?? 0;
  const finished = status === "DELIVERED" || status === "CLOSED";
  return (
    <div>
    <ol className="grid" style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }} aria-label={`Step ${cur + 1} of ${STEPS.length}: ${STEPS[cur]}`}>
      {STEPS.map((s, i) => {
        const done = i < cur || finished;
        const now = i === cur && !finished;
        return (
          <li key={s} className="relative flex flex-col items-center text-center">
            {i > 0 && <span className={cn("absolute right-1/2 top-[6px] h-[2px] w-full", done || now ? "bg-ok-600" : "bg-line-strong")} aria-hidden />}
            <span
              className={cn(
                "relative z-10 grid place-items-center rounded-full border-2",
                compact ? "size-[12px]" : "size-[14px]",
                done ? "border-ok-600 bg-ok-600" : now ? (held ? "border-warn-600 bg-white" : "border-navy-900 bg-white") : "border-line-strong bg-white",
              )}
            >
              {now && <span className={cn("block rounded-full", compact ? "size-[4px]" : "size-[6px]", held ? "bg-warn-600" : "bg-navy-900")} />}
            </span>
            {!compact && <span className={cn("mt-1 hidden text-[10.5px] leading-tight sm:block", now ? (held ? "font-semibold text-warn-700" : "font-semibold text-ink") : done ? "text-muted" : "text-faint")}>{s}</span>}
          </li>
        );
      })}
    </ol>
    {!compact && (
      <p className={cn("mt-2 text-center text-[12px] sm:hidden", held ? "text-warn-700" : "text-ink")}>
        {finished ? "Delivered" : <>Step {cur + 1} of {STEPS.length} · <b className="font-semibold">{STEPS[cur]}</b>{held ? " (held up)" : ""}</>}
      </p>
    )}
    </div>
  );
}
