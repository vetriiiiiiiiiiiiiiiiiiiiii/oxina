import { addWorkingMinutes, nextWorkingMoment, workingMinutesBetween, type WorkCalendar } from "./calendar";

/**
 * Service-job ETA calculation (pure; no database access).
 *
 * The remaining work is list-scheduled twice — once with optimistic (min) and once with
 * pessimistic (max) task durations — over the branch working calendar, honouring
 * task dependencies, mechanic lanes (parallel work), existing mechanic workload,
 * parts availability dates and pending customer approval. The two runs give a range.
 */

export type PartsState = { kind: "READY" } | { kind: "EXPECTED"; at: Date } | { kind: "UNKNOWN" };

export interface EtaTask {
  id: string;
  title: string;
  status: "PENDING" | "READY" | "IN_PROGRESS" | "PAUSED" | "BLOCKED" | "COMPLETED" | "CANCELLED";
  minMinutes: number;
  maxMinutes: number;
  /** Minutes already worked (closed work-log segments). */
  workedMinutes: number;
  /** Start of the currently running segment, if IN_PROGRESS. */
  runningSince?: Date | null;
  dependsOn: string[];
  mechanicId?: string | null;
  awaitingApproval: boolean;
  parts: PartsState;
}

export interface Range {
  min: number;
  max: number;
}

export interface EtaInput {
  now: Date;
  receivedAt: Date;
  calendar: WorkCalendar;
  tasks: EtaTask[];
  /** Queued minutes of other jobs per mechanic (existing workload). */
  mechanicBacklog: Record<string, Range>;
  /** Parallel lanes for unassigned tasks (mechanics available to the job / free bays). */
  poolLanes: number;
  /** Assumed customer response time while approval is pending. */
  approvalWait: Range;
  /** QC + test ride + final billing after repairs. */
  postRepair: Range;
  /** Work before repairs that has not happened yet (e.g. inspection + estimate). */
  preRepair?: Range;
}

export interface EtaResult {
  earliest: Date | null;
  latest: Date | null;
  confidence: "FIRM" | "RANGE" | "PROVISIONAL" | "UNKNOWN";
  breakdown: {
    activeMinutes: Range;
    queueMinutes: Range;
    partsWaitMinutes: number;
    approvalPending: boolean;
    elapsedMinutes: number;
    unknownParts: string[];
    criticalPath: string[];
  };
  reason: string;
}

const LIVE = (t: EtaTask) => t.status !== "COMPLETED" && t.status !== "CANCELLED";

function remaining(t: EtaTask, dur: number, now: Date) {
  const running = t.status === "IN_PROGRESS" && t.runningSince ? Math.max(0, (now.getTime() - t.runningSince.getTime()) / 60_000) : 0;
  // Never assume an over-running task is done: keep at least 10 minutes.
  return Math.max(10, Math.round(dur - t.workedMinutes - running));
}

function topoSort(tasks: EtaTask[]): EtaTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: EtaTask[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (t: EtaTask) => {
    const s = state.get(t.id);
    if (s === 2) return;
    if (s === 1) throw new Error(`Dependency cycle at task "${t.title}"`);
    state.set(t.id, 1);
    for (const d of t.dependsOn) {
      const dep = byId.get(d);
      if (dep) visit(dep);
    }
    state.set(t.id, 2);
    out.push(t);
  };
  tasks.forEach(visit);
  return out;
}

function schedule(input: EtaInput, scenario: "min" | "max") {
  const { now, calendar: cal } = input;
  const live = topoSort(input.tasks.filter(LIVE));
  const start0 = nextWorkingMoment(cal, now);
  const pre = input.preRepair?.[scenario] ?? 0;
  const repairStart = pre ? addWorkingMinutes(cal, start0, pre) : start0;
  const approvalReady = addWorkingMinutes(cal, repairStart, input.approvalWait[scenario]);

  const lanes = new Map<string, Date>();
  const laneFor = (mech: string) => {
    if (!lanes.has(mech)) {
      const backlog = input.mechanicBacklog[mech]?.[scenario] ?? 0;
      lanes.set(mech, backlog ? addWorkingMinutes(cal, repairStart, backlog) : repairStart);
    }
    return lanes.get(mech)!;
  };
  const pool: Date[] = Array.from({ length: Math.max(1, input.poolLanes) }, () => repairStart);

  const finish = new Map<string, Date>();
  const prevOnPath = new Map<string, string | null>();
  let active = 0;
  let queue = 0;
  let end = repairStart;
  let lastId: string | null = null;

  for (const t of live) {
    let ready = repairStart;
    let via: string | null = null;
    for (const d of t.dependsOn) {
      const f = finish.get(d);
      if (f && f > ready) {
        ready = f;
        via = d;
      }
    }
    if (t.awaitingApproval && approvalReady > ready) ready = approvalReady;
    if (t.parts.kind === "EXPECTED" && t.parts.at > ready) ready = nextWorkingMoment(cal, t.parts.at);

    let laneFree: Date;
    let poolIdx = -1;
    if (t.mechanicId) laneFree = laneFor(t.mechanicId);
    else {
      poolIdx = pool.reduce((best, d, i) => (d < pool[best] ? i : best), 0);
      laneFree = pool[poolIdx];
    }
    const start = laneFree > ready ? laneFree : ready;
    queue += workingMinutesBetween(cal, ready, start);
    const dur = remaining(t, scenario === "min" ? t.minMinutes : t.maxMinutes, now);
    active += dur;
    const done = addWorkingMinutes(cal, start, dur);
    finish.set(t.id, done);
    prevOnPath.set(t.id, via);
    if (t.mechanicId) lanes.set(t.mechanicId, done);
    else pool[poolIdx] = done;
    if (done > end) {
      end = done;
      lastId = t.id;
    }
  }

  const path: string[] = [];
  for (let id = lastId; id; id = prevOnPath.get(id) ?? null) path.unshift(id);
  const completion = addWorkingMinutes(cal, end, input.postRepair[scenario]);
  return { completion, active: active + pre + input.postRepair[scenario], queue, path };
}

export function calculateEta(input: EtaInput): EtaResult {
  const live = input.tasks.filter(LIVE);
  const unknownParts = live.filter((t) => t.parts.kind === "UNKNOWN").map((t) => t.title);
  const approvalPending = live.some((t) => t.awaitingApproval);
  const elapsedMinutes = Math.max(0, Math.round((input.now.getTime() - input.receivedAt.getTime()) / 60_000));
  const partsDates = live.flatMap((t) => (t.parts.kind === "EXPECTED" ? [t.parts.at] : []));
  const latestPart = partsDates.length ? new Date(Math.max(...partsDates.map((d) => d.getTime()))) : null;
  const partsWaitMinutes = latestPart ? workingMinutesBetween(input.calendar, input.now, latestPart) : 0;

  const lo = schedule(input, "min");
  const hi = schedule(input, "max");
  const base = {
    activeMinutes: { min: lo.active, max: hi.active },
    queueMinutes: { min: lo.queue, max: hi.queue },
    partsWaitMinutes,
    approvalPending,
    elapsedMinutes,
    unknownParts,
    criticalPath: hi.path,
  };

  if (unknownParts.length) {
    return {
      earliest: null,
      latest: null,
      confidence: "UNKNOWN",
      breakdown: base,
      reason: "Waiting for a confirmed availability date for one or more spare parts.",
    };
  }
  const provisional = approvalPending || partsWaitMinutes > 0;
  const narrow = hi.completion.getTime() - lo.completion.getTime() <= 30 * 60_000;
  return {
    earliest: lo.completion,
    latest: hi.completion,
    confidence: provisional ? "PROVISIONAL" : narrow ? "FIRM" : "RANGE",
    breakdown: base,
    reason: provisional
      ? approvalPending
        ? "Depends on your approval of the estimate."
        : "Depends on the recorded spare-part arrival date."
      : "Based on remaining work, mechanic availability and workshop hours.",
  };
}
