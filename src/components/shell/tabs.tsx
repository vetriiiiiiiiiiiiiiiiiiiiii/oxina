import Link from "next/link";
import { cn } from "@/lib/utils";

export function LinkTabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <div className="mb-4 flex gap-5 overflow-x-auto border-b border-line text-[14px]">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} aria-current={active === t.key ? "page" : undefined} className={cn("-mb-px whitespace-nowrap border-b-2 pb-1.5", active === t.key ? "border-navy-900 font-medium text-ink" : "border-transparent text-muted hover:text-ink")}>
          {t.label}
          {t.count !== undefined && <span className="ml-1 font-mono text-[12px] text-faint">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function Pager({ page, pageSize, total, base }: { page: number; pageSize: number; total: number; base: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const sep = base.includes("?") ? "&" : "?";
  return (
    <div className="flex items-center justify-between px-3 py-2 text-[13px] text-muted">
      <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
      <div className="flex gap-3">
        {page > 1 && <Link className="text-brand-600 hover:underline" href={`${base}${sep}page=${page - 1}`}>← Previous</Link>}
        {page < pages && <Link className="text-brand-600 hover:underline" href={`${base}${sep}page=${page + 1}`}>Next →</Link>}
      </div>
    </div>
  );
}
