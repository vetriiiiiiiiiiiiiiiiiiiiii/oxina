"use client";
import { Card } from "@/components/ui";
import { ActionButton } from "@/components/forms/action-button";
import { fmtTime, fmtMinutes } from "@/lib/utils";

type Rec = { clockInAt: string | null; clockOutAt: string | null; onBreakSince: string | null; breakMinutes: number; workedMinutes: number | null; isLate: boolean } | null;

export function AttendanceWidget({ data }: { data: { employee: { fullName: string; employeeCode: string; branch: string; timezone: string }; record: Rec } | null }) {
  if (!data) return null;
  const r = data.record;
  const tz = data.employee.timezone;
  const state = !r?.clockInAt ? "out" : r.clockOutAt ? "done" : r.onBreakSince ? "break" : "in";
  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 px-4 py-2.5">
      <div>
        <div>
          <p className="text-sm font-medium">
            {state === "out" && "You haven't clocked in today"}
            {state === "in" && `Clocked in at ${fmtTime(r!.clockInAt, tz)}${r!.isLate ? " (late)" : ""}`}
            {state === "break" && `On break since ${fmtTime(r!.onBreakSince, tz)}`}
            {state === "done" && `Day complete · ${fmtMinutes(r!.workedMinutes)} worked`}
          </p>
          <p className="text-xs text-muted">{data.employee.employeeCode} · {data.employee.branch} · self-reported</p>
        </div>
      </div>
      <div className="flex gap-2">
        {state === "out" && <ActionButton size="sm" url="/api/attendance/clock" body={{ action: "IN" }} success="Clocked in.">Clock in</ActionButton>}
        {state === "in" && <><ActionButton size="sm" variant="outline" url="/api/attendance/clock" body={{ action: "BREAK_START" }} success="Break started.">Start break</ActionButton><ActionButton size="sm" variant="secondary" url="/api/attendance/clock" body={{ action: "OUT" }} confirm="Clock out for the day?" success="Clocked out.">Clock out</ActionButton></>}
        {state === "break" && <ActionButton size="sm" url="/api/attendance/clock" body={{ action: "BREAK_END" }} success="Break ended.">End break</ActionButton>}
      </div>
    </Card>
  );
}
