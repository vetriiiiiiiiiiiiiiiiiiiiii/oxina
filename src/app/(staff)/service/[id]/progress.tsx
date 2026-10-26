import { cn } from "@/lib/utils";

const STEPS = ["Reception", "Inspection", "Estimate", "Parts & repair", "Quality check", "Billing", "Ready", "Delivered"];
const STEP_OF: Record<string, number> = {
  RECEIVED: 0, INSPECTION: 1, AWAITING_APPROVAL: 2, APPROVED: 3, PARTS_PENDING: 3, IN_REPAIR: 3,
  QUALITY_CHECK: 4, FINAL_BILLING: 5, READY_FOR_DELIVERY: 6, DELIVERED: 7, CLOSED: 7,
};

/** Where the job is in the workshop flow. */
export function StageBar({ status, held }: { status: string; held?: boolean }) {
  if (status === "CANCELLED") return <p className="border border-line bg-white px-4 py-2 text-sm text-muted">This job was cancelled.</p>;
  const cur = STEP_OF[status] ?? 0;
  const closed = status === "CLOSED" || status === "DELIVERED";
  return (
    <ol className="flex overflow-x-auto border border-line bg-white text-[13px]">
      {STEPS.map((s, i) => {
        const done = i < cur || closed;
        const now = i === cur && !closed;
        return (
          <li key={s} className={cn("min-w-[104px] flex-1 border-t-[3px] px-3 py-2", i > 0 && "border-l border-l-line", done ? "border-t-ok-600 text-muted" : now ? (held ? "border-t-warn-600 bg-warn-50 font-semibold text-ink" : "border-t-navy-900 bg-shade font-semibold text-ink") : "border-t-transparent text-faint")}>
            <span className="mr-1.5 font-mono text-[11px]">{i + 1}</span>
            {s}
            {now && held && <span className="block text-[11px] font-normal text-warn-700">held up</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function SectionNav({ sections }: { sections: [string, string, number?][] }) {
  return (
    <nav className="sticky top-12 z-20 -mx-4 flex gap-4 overflow-x-auto border-b border-line bg-canvas/95 px-4 py-2 text-[13px] backdrop-blur-sm sm:-mx-6 sm:px-6" aria-label="Sections">
      {sections.map(([id, label, n]) => (
        <a key={id} href={`#${id}`} className="whitespace-nowrap text-brand-600 hover:underline">
          {label}{n ? <span className="ml-1 font-mono text-[11px] text-muted">{n}</span> : null}
        </a>
      ))}
    </nav>
  );
}

export function NextStep({ title, detail, children, tone = "navy" }: { title: string; detail?: React.ReactNode; children?: React.ReactNode; tone?: "navy" | "warn" | "ok" | "muted" }) {
  const bar = { navy: "border-l-navy-900", warn: "border-l-warn-600", ok: "border-l-ok-600", muted: "border-l-line-strong" }[tone];
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border border-line border-l-[3px] bg-white px-4 py-3", bar)}>
      <div className="min-w-0">
        <p className="text-[12px] text-muted">Next step</p>
        <p className="text-[15px] font-semibold">{title}</p>
        {detail && <p className="text-[13px] text-muted">{detail}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
