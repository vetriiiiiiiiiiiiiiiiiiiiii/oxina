"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const PRESETS = [["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["month", "This month"]] as const;

export function RangeFilter() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const preset = sp.get("preset") ?? "30d";
  const set = (patch: Record<string, string>) => {
    const p = new URLSearchParams(sp.toString());
    Object.entries(patch).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    router.push(`${path}?${p.toString()}`);
  };
  return (
    <div className="flex flex-wrap items-center gap-3 text-[13px]">
      <div className="flex gap-3">
        {PRESETS.map(([k, l]) => (
          <button key={k} onClick={() => set({ preset: k, from: "", to: "" })} className={cn(preset === k ? "font-medium text-ink underline decoration-2 underline-offset-4" : "text-brand-600 hover:underline")}>
            {l}
          </button>
        ))}
      </div>
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          set({ preset: "custom", from: String(f.get("from")), to: String(f.get("to")) });
        }}
      >
        <input type="date" name="from" required defaultValue={sp.get("from") ?? ""} className="h-7 rounded-[3px] border border-line-strong bg-white px-1.5 text-[13px]" aria-label="From" />
        <span className="text-muted">–</span>
        <input type="date" name="to" required defaultValue={sp.get("to") ?? ""} className="h-7 rounded-[3px] border border-line-strong bg-white px-1.5 text-[13px]" aria-label="To" />
        <button className="h-7 rounded-[3px] border border-line-strong bg-white px-2 hover:border-ink">Go</button>
      </form>
    </div>
  );
}
