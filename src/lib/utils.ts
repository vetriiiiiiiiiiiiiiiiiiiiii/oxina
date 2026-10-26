import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatInTimeZone } from "date-fns-tz";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const DEFAULT_TZ = "Asia/Kolkata";

export function fmtDateTime(d: Date | string | null | undefined, tz = DEFAULT_TZ) {
  if (!d) return "—";
  return formatInTimeZone(new Date(d), tz, "d MMM yyyy, h:mm a");
}
export function fmtDate(d: Date | string | null | undefined, tz = DEFAULT_TZ) {
  if (!d) return "—";
  return formatInTimeZone(new Date(d), tz, "d MMM yyyy");
}
export function fmtTime(d: Date | string | null | undefined, tz = DEFAULT_TZ) {
  if (!d) return "—";
  return formatInTimeZone(new Date(d), tz, "h:mm a");
}
export function fmtMoney(v: unknown) {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
}
export function fmtMinutes(m: number | null | undefined) {
  if (m === null || m === undefined) return "—";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
export function etaText(e: { earliest: Date | string | null; latest: Date | string | null; confidence?: string | null }, tz = DEFAULT_TZ) {
  if (!e.latest) return null;
  const a = fmtDateTime(e.earliest, tz);
  const b = fmtDateTime(e.latest, tz);
  if (a === b || e.confidence === "FIRM") return b;
  const sameDay = fmtDate(e.earliest, tz) === fmtDate(e.latest, tz);
  return sameDay ? `${fmtDate(e.latest, tz)}, ${fmtTime(e.earliest, tz)} – ${fmtTime(e.latest, tz)}` : `${a} – ${b}`;
}
export const titleCase = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
