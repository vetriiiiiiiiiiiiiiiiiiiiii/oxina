import * as React from "react";
import { cn } from "@/lib/utils";

/* Buttons ---------------------------------------------------------------- */

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "outline";
const btnStyles: Record<BtnVariant, string> = {
  primary: "bg-navy-900 text-white border border-navy-900 hover:bg-navy-800",
  secondary: "bg-navy-900 text-white border border-navy-900 hover:bg-navy-800",
  outline: "bg-white text-ink border border-line-strong hover:border-ink",
  ghost: "text-brand-600 border border-transparent hover:underline",
  danger: "bg-white text-bad-700 border border-bad-600/50 hover:bg-bad-50",
  success: "bg-ok-700 text-white border border-ok-700 hover:bg-ok-600",
};
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant = "primary", size = "md", loading, disabled, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[3px] font-medium disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-[13px]" : size === "lg" ? "h-10 px-5 text-[15px]" : "h-8 px-3.5 text-sm",
        btnStyles[variant],
        className,
      )}
      {...props}
    >
      {children}
      {loading && <span className="text-xs opacity-70">…</span>}
    </button>
  );
});

/* Panels ----------------------------------------------------------------- */

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-[var(--radius-card)] border border-line bg-surface", className)} {...p} />;
}
export function CardHeader({ title, description, action, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-2.5", className)}>
      <div className="min-w-0">
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        {description && <p className="text-[13px] text-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}
export function CardBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-3.5", className)} {...p} />;
}

/* Status ----------------------------------------------------------------- */

type Tone = "neutral" | "brand" | "ok" | "warn" | "bad" | "navy";
const toneText: Record<Tone, string> = {
  neutral: "text-muted",
  brand: "text-brand-700",
  ok: "text-ok-700",
  warn: "text-warn-700",
  bad: "text-bad-700",
  navy: "text-navy-900",
};
const toneMark: Record<Tone, string> = {
  neutral: "bg-faint",
  brand: "bg-brand-600",
  ok: "bg-ok-600",
  warn: "bg-warn-600",
  bad: "bg-bad-600",
  navy: "bg-navy-900",
};

/** Small bordered tag for secondary labels (codes, flags). */
export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-block whitespace-nowrap rounded-[2px] border border-current/25 px-1 text-[11px] leading-[17px]", toneText[tone], className)}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  RECEIVED: "neutral", INSPECTION: "brand", AWAITING_APPROVAL: "warn", APPROVED: "brand", PARTS_PENDING: "bad", IN_REPAIR: "brand",
  QUALITY_CHECK: "brand", FINAL_BILLING: "warn", READY_FOR_DELIVERY: "ok", DELIVERED: "ok", CLOSED: "neutral", CANCELLED: "neutral",
  PENDING: "neutral", READY: "brand", IN_PROGRESS: "brand", PAUSED: "warn", BLOCKED: "bad", COMPLETED: "ok",
  REQUESTED: "neutral", RESERVED: "brand", PICKING: "brand", PICKED: "brand", ISSUED: "ok", UNAVAILABLE: "bad", AWAITING_PROCUREMENT: "warn",
  DRAFT: "neutral", SENT: "warn", PARTIALLY_APPROVED: "warn", REJECTED: "bad", SUPERSEDED: "neutral",
  FINALIZED: "brand", PARTIALLY_PAID: "warn", PAID: "ok", PENDING_CONFIRMATION: "warn", CONFIRMED: "ok", FAILED: "bad", REVERSED: "neutral",
  PASSED: "ok", AVAILABLE: "ok", BOOKING_CONFIRMED: "brand", SUBMITTED: "warn", UNDER_REVIEW: "warn", SETTLED: "ok",
  NEW: "brand", CONTACTED: "brand", TEST_RIDE_SCHEDULED: "brand", QUOTED: "warn", BOOKED: "ok", LOST: "neutral",
  ACTIVE: "ok", DISPATCHED: "warn", PARTIALLY_RECEIVED: "warn", QUEUED: "neutral", SKIPPED_NO_PROVIDER: "neutral",
};

/** Status as plain coloured text with a small square marker — reads like a ledger, not a pill. */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  const text = label ?? status.toLowerCase().replace(/_/g, " ");
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[13px]", toneText[tone])}>
      <span className={cn("size-[7px] shrink-0", toneMark[tone])} aria-hidden />
      {text.charAt(0).toUpperCase() + text.slice(1)}
    </span>
  );
}

/* Form controls ---------------------------------------------------------- */

const fieldCls = "w-full rounded-[3px] border border-line-strong bg-white px-2.5 text-sm text-ink placeholder:text-faint focus:border-navy-700 focus:outline-none disabled:bg-shade aria-[invalid=true]:border-bad-600";
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(fieldCls, "h-8", className)} {...p} />;
});
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) {
  return <select ref={ref} className={cn(fieldCls, "h-8 pr-7", className)} {...p} />;
});
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(fieldCls, "min-h-16 py-1.5", className)} {...p} />;
});
export function Field({ label, hint, error, children, className, required }: { label: React.ReactNode; hint?: React.ReactNode; error?: string; children: React.ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-[13px] text-ink">
        {label}
        {required && <span className="text-bad-600"> *</span>}
      </span>
      {children}
      {error ? <span className="mt-1 block text-[12px] text-bad-700">{error}</span> : hint ? <span className="mt-1 block text-[12px] text-muted">{hint}</span> : null}
    </label>
  );
}

/* Tables ----------------------------------------------------------------- */

export function Table({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-left text-sm", className)} {...p} />
    </div>
  );
}
export function Th({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("whitespace-nowrap border-b border-line-strong bg-shade px-3 py-1.5 text-[12px] font-semibold text-muted", className)} {...p} />;
}
export function Td({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-line px-3 py-2 align-top", className)} {...p} />;
}

/* Page furniture --------------------------------------------------------- */

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="px-4 py-6 text-sm">
      <p className="text-muted">{title}{description ? <span className="text-faint"> — {description}</span> : null}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("bg-line/60", className)} />;
}

export function PageHeader({ title, description, actions, eyebrow }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line pb-3">
      <div className="min-w-0">
        {eyebrow && <div className="mb-0.5 text-[13px] text-muted [&_a]:hover:underline">{eyebrow}</div>}
        <h1 className="text-[21px] font-semibold leading-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A single figure. Icons are intentionally not rendered. */
export function Stat({ label, value, hint, tone = "neutral", href }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "neutral" | "ok" | "warn" | "bad" | "brand"; icon?: React.ReactNode; href?: string }) {
  const color = { neutral: "text-ink", ok: "text-ok-700", warn: "text-warn-700", bad: "text-bad-700", brand: "text-navy-900" }[tone];
  const inner = (
    <div className={cn("h-full border border-line bg-white px-3 py-2.5", href && "hover:border-line-strong")}>
      <p className="text-[12px] text-muted">{label}</p>
      <p className={cn("mt-0.5 font-mono text-[20px] font-medium tabular-nums leading-tight", color)}>{value}</p>
      {hint && <p className="mt-0.5 text-[12px] text-faint">{hint}</p>}
    </div>
  );
  return href ? <a href={href} className="block">{inner}</a> : inner;
}

export function DL({ items, className }: { items: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[12px] text-muted">{k}</dt>
          <dd className="break-words text-sm text-ink">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Notice({ tone = "brand", title, children }: { tone?: "brand" | "ok" | "warn" | "bad"; title?: string; children: React.ReactNode }) {
  const bar = { brand: "border-l-navy-700", ok: "border-l-ok-600", warn: "border-l-warn-600", bad: "border-l-bad-600" }[tone];
  return (
    <div className={cn("border border-line border-l-[3px] bg-white px-3 py-2 text-[13px] text-ink", bar)} role={tone === "bad" ? "alert" : "status"}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? "text-muted" : ""}>{children}</div>
    </div>
  );
}
