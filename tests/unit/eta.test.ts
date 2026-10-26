import { describe, expect, it } from "vitest";
import { calculateEta, type EtaInput, type EtaTask } from "@/lib/eta/calculate";
import { addWorkingMinutes, workingMinutesBetween } from "@/lib/eta/calendar";

// Mon 26 Oct 2026, 10:00 IST
const NOW = new Date("2026-10-26T04:30:00Z");
const cal = { timezone: "Asia/Kolkata", workdayStart: "09:30", workdayEnd: "18:30", workingDays: [1, 2, 3, 4, 5, 6], holidays: [] as string[] };
const task = (p: Partial<EtaTask> & { id: string }): EtaTask => ({ title: p.id, status: "READY", minMinutes: 60, maxMinutes: 60, workedMinutes: 0, dependsOn: [], awaitingApproval: false, parts: { kind: "READY" }, ...p });
const base = (tasks: EtaTask[], extra: Partial<EtaInput> = {}): EtaInput => ({ now: NOW, receivedAt: NOW, calendar: cal, tasks, mechanicBacklog: {}, poolLanes: 1, approvalWait: { min: 0, max: 0 }, postRepair: { min: 0, max: 0 }, ...extra });

describe("working calendar", () => {
  it("skips closed hours, Sundays and holidays", () => {
    // Sat 31 Oct 17:30 IST + 120 min → 60 min Sat, Sunday closed, Monday holiday → Tue 10:30
    const sat = new Date("2026-10-31T12:00:00Z");
    const out = addWorkingMinutes({ ...cal, holidays: ["2026-11-02"] }, sat, 120);
    expect(out.toISOString()).toBe("2026-11-03T05:00:00.000Z");
    expect(workingMinutesBetween(cal, NOW, new Date("2026-10-26T06:30:00Z"))).toBe(120);
  });
});

describe("ETA calculation (test 14)", () => {
  it("gives a range from min/max durations and respects workshop hours", () => {
    const r = calculateEta(base([task({ id: "a", minMinutes: 60, maxMinutes: 120 })]));
    expect(r.earliest!.toISOString()).toBe("2026-10-26T05:30:00.000Z");
    expect(r.latest!.toISOString()).toBe("2026-10-26T06:30:00.000Z");
    expect(r.confidence).toBe("RANGE");
  });

  it("runs independent tasks in parallel lanes and dependent tasks in sequence", () => {
    const tasks = [task({ id: "a", mechanicId: "m1" }), task({ id: "b", mechanicId: "m2" })];
    const parallel = calculateEta(base(tasks));
    const serial = calculateEta(base([task({ id: "a", mechanicId: "m1" }), task({ id: "b", mechanicId: "m2", dependsOn: ["a"] })]));
    expect(parallel.latest!.getTime()).toBe(NOW.getTime() + 60 * 60_000);
    expect(serial.latest!.getTime()).toBe(NOW.getTime() + 120 * 60_000);
  });

  it("moves later when a task is delayed (existing mechanic workload / slower work)", () => {
    const before = calculateEta(base([task({ id: "a", mechanicId: "m1" })]));
    const busy = calculateEta(base([task({ id: "a", mechanicId: "m1" })], { mechanicBacklog: { m1: { min: 90, max: 90 } } }));
    expect(busy.latest!.getTime() - before.latest!.getTime()).toBe(90 * 60_000);
    expect(busy.breakdown.queueMinutes.max).toBe(90);
  });

  it("moves earlier as work is completed", () => {
    const fresh = calculateEta(base([task({ id: "a", minMinutes: 120, maxMinutes: 120 })]));
    const half = calculateEta(base([task({ id: "a", minMinutes: 120, maxMinutes: 120, workedMinutes: 60, status: "PAUSED" })]));
    const done = calculateEta(base([task({ id: "a", status: "COMPLETED" }), task({ id: "b", minMinutes: 30, maxMinutes: 30 })]));
    expect(half.latest! < fresh.latest!).toBe(true);
    expect(done.latest!.getTime()).toBe(NOW.getTime() + 30 * 60_000);
  });

  it("waits for a recorded part arrival date and is provisional", () => {
    const at = new Date("2026-10-28T06:00:00Z"); // Wed 11:30 IST
    const r = calculateEta(base([task({ id: "a", parts: { kind: "EXPECTED", at } })]));
    expect(r.earliest!.getTime()).toBe(at.getTime() + 60 * 60_000);
    expect(r.confidence).toBe("PROVISIONAL");
    expect(r.breakdown.partsWaitMinutes).toBeGreaterThan(0);
  });

  it("promises nothing when a part has no recorded availability date", () => {
    const r = calculateEta(base([task({ id: "a", parts: { kind: "UNKNOWN" } })]));
    expect(r.latest).toBeNull();
    expect(r.confidence).toBe("UNKNOWN");
  });

  it("recalculates when the part arrives (UNKNOWN → READY)", () => {
    const before = calculateEta(base([task({ id: "a", parts: { kind: "UNKNOWN" } })]));
    const after = calculateEta(base([task({ id: "a", parts: { kind: "READY" } })]));
    expect(before.latest).toBeNull();
    expect(after.latest).not.toBeNull();
  });

  it("adds customer approval wait for unapproved work", () => {
    const r = calculateEta(base([task({ id: "a", awaitingApproval: true })], { approvalWait: { min: 30, max: 240 } }));
    expect(r.confidence).toBe("PROVISIONAL");
    expect(r.latest!.getTime()).toBe(NOW.getTime() + (240 + 60) * 60_000);
  });
});

import { buildStageView } from "@/lib/service/stages";

describe("customer stage view", () => {
  it("marks an active stage done once a later stage has started, but keeps blocked stages blocked", () => {
    const at = (m: number) => new Date(Date.UTC(2026, 9, 26, 5, m));
    const v = buildStageView(
      [
        { stage: "VEHICLE_RECEIVED", state: "COMPLETED", title: "", occurredAt: at(0) },
        { stage: "INSPECTION_IN_PROGRESS", state: "ACTIVE", title: "", occurredAt: at(1) },
        { stage: "PARTS_BEING_ARRANGED", state: "BLOCKED", title: "", occurredAt: at(2) },
        { stage: "REPAIR_IN_PROGRESS", state: "ACTIVE", title: "", occurredAt: at(3) },
      ],
      "IN_REPAIR",
    );
    const st = Object.fromEntries(v.map((x) => [x.key, x.state]));
    expect(st.INSPECTION_IN_PROGRESS).toBe("COMPLETED");
    expect(st.PARTS_BEING_ARRANGED).toBe("BLOCKED");
    expect(st.REPAIR_IN_PROGRESS).toBe("ACTIVE");
    expect(st.QUALITY_INSPECTION).toBe("PENDING");
  });
});
