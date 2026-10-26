/** Text wordmark. Replace with the official Oxina Groups logo file when it is supplied. */
export function Logo({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <span className={`inline-flex items-baseline gap-2 ${light ? "text-white" : "text-navy-900"}`}>
      <span className="text-[15px] font-semibold tracking-[0.06em]">OXINA</span>
      {!compact && <span className={`text-[13px] ${light ? "text-white/60" : "text-muted"}`}>Operations</span>}
    </span>
  );
}
