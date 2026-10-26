import { fromZonedTime, toZonedTime, formatInTimeZone } from "date-fns-tz";

export interface WorkCalendar {
  timezone: string;
  workdayStart: string; // "09:30"
  workdayEnd: string; // "18:30"
  workingDays: number[]; // ISO 1..7
  holidays: string[]; // "YYYY-MM-DD" local dates
}

const MIN = 60_000;

function localDateStr(d: Date, tz: string) {
  return formatInTimeZone(d, tz, "yyyy-MM-dd");
}
function atLocal(dateStr: string, hhmm: string, tz: string) {
  return fromZonedTime(`${dateStr}T${hhmm}:00`, tz);
}
function isoWeekday(dateStr: string, tz: string) {
  const d = toZonedTime(atLocal(dateStr, "12:00", tz), tz);
  const js = d.getDay();
  return js === 0 ? 7 : js;
}
function nextDateStr(dateStr: string, tz: string) {
  // Noon + 24h avoids DST edge cases.
  return localDateStr(new Date(atLocal(dateStr, "12:00", tz).getTime() + 24 * 60 * MIN), tz);
}

export function isWorkingDate(cal: WorkCalendar, dateStr: string) {
  return cal.workingDays.includes(isoWeekday(dateStr, cal.timezone)) && !cal.holidays.includes(dateStr);
}

/** The first instant >= t that falls inside working hours. */
export function nextWorkingMoment(cal: WorkCalendar, t: Date): Date {
  let dateStr = localDateStr(t, cal.timezone);
  for (let i = 0; i < 400; i++) {
    if (isWorkingDate(cal, dateStr)) {
      const start = atLocal(dateStr, cal.workdayStart, cal.timezone);
      const end = atLocal(dateStr, cal.workdayEnd, cal.timezone);
      if (t < start) return start;
      if (t < end) return t;
    }
    dateStr = nextDateStr(dateStr, cal.timezone);
    t = atLocal(dateStr, "00:00", cal.timezone);
  }
  throw new Error("No working time found within 400 days — check branch calendar");
}

/** Add `minutes` of workshop working time to `t`. */
export function addWorkingMinutes(cal: WorkCalendar, t: Date, minutes: number): Date {
  let cur = nextWorkingMoment(cal, t);
  let left = Math.max(0, Math.round(minutes));
  for (let i = 0; i < 2000; i++) {
    const end = atLocal(localDateStr(cur, cal.timezone), cal.workdayEnd, cal.timezone);
    const avail = Math.floor((end.getTime() - cur.getTime()) / MIN);
    if (left <= avail) return new Date(cur.getTime() + left * MIN);
    left -= avail;
    cur = nextWorkingMoment(cal, new Date(end.getTime() + MIN));
  }
  throw new Error("Working-minute calculation overflow");
}

/** Working minutes between a and b (0 if b <= a). */
export function workingMinutesBetween(cal: WorkCalendar, a: Date, b: Date): number {
  if (b <= a) return 0;
  let total = 0;
  let cur = nextWorkingMoment(cal, a);
  for (let i = 0; i < 2000 && cur < b; i++) {
    const end = atLocal(localDateStr(cur, cal.timezone), cal.workdayEnd, cal.timezone);
    const stop = end < b ? end : b;
    total += Math.max(0, Math.floor((stop.getTime() - cur.getTime()) / MIN));
    if (end >= b) break;
    cur = nextWorkingMoment(cal, new Date(end.getTime() + MIN));
  }
  return total;
}
