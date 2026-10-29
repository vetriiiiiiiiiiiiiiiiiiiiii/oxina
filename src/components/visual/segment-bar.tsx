import Link from "next/link";
import { cn } from "@/lib/utils";

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string; // CSS colour or var()
  href?: string;
}

/**
 * One horizontal bar split into proportional segments, with a labelled legend underneath
 * (identity is never colour-alone). Each segment has a hover title; zero segments are omitted
 * from the bar but kept in the legend.
 */
export function SegmentBar({ segments, total, height = 14, showLegend = true, unit = "" }: { segments: Segment[]; total?: number; height?: number; showLegend?: boolean; unit?: string }) {
  const sum = total ?? segments.reduce((a, s) => a + s.value, 0);
  return (
    <div>
      <div className="flex w-full gap-[2px] overflow-hidden rounded-[3px] bg-line/50" style={{ height }} role="img" aria-label={segments.map((s) => `${s.label} ${s.value}${unit}`).join(", ")}>
        {sum > 0 && segments.filter((s) => s.value > 0).map((s) => {
          const el = <span className="block h-full" style={{ width: `${(s.value / sum) * 100}%`, background: s.color, minWidth: 3 }} title={`${s.label}: ${s.value}${unit}`} />;
          return s.href ? <Link key={s.key} href={s.href} className="contents">{el}</Link> : <span key={s.key} className="contents">{el}</span>;
        })}
      </div>
      {showLegend && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          {segments.map((s) => {
            const body = (
              <>
                <span className="inline-block size-[9px] shrink-0 rounded-[2px]" style={{ background: s.color }} />
                <span className={cn(s.value === 0 ? "text-faint" : "text-ink")}>{s.label}</span>
                <span className="font-mono text-muted">{s.value}{unit}</span>
              </>
            );
            return <li key={s.key}>{s.href ? <Link href={s.href} className="inline-flex items-center gap-1.5 hover:underline">{body}</Link> : <span className="inline-flex items-center gap-1.5">{body}</span>}</li>;
          })}
        </ul>
      )}
    </div>
  );
}

/** Horizontal bars, one per row, labelled and valued (for "top N" style lists). */
export function BarList({ rows, color = "var(--color-dept-workshop)", unit = "", format }: { rows: { label: React.ReactNode; value: number; href?: string; sub?: string }[]; color?: string; unit?: string; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-1.5">
      {rows.map((r, i) => {
        const inner = (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-[13px]">
            <span className="truncate">{r.label}{r.sub && <span className="ml-1 text-[12px] text-muted">{r.sub}</span>}</span>
            <span className="font-mono text-muted">{format ? format(r.value) : r.value}{unit}</span>
            <span className="col-span-2 mt-0.5 block h-[6px] rounded-[2px] bg-line/50">
              <span className="block h-full rounded-[2px]" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: color }} title={`${typeof r.label === "string" ? r.label : ""} ${r.value}${unit}`} />
            </span>
          </div>
        );
        return <li key={i}>{r.href ? <Link href={r.href} className="block hover:opacity-80">{inner}</Link> : inner}</li>;
      })}
    </ul>
  );
}
