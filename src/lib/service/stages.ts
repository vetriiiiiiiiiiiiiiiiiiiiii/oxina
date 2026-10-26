/** Customer-visible service timeline stages, in display order. */
export const STAGES = [
  { key: "VEHICLE_RECEIVED", label: "Vehicle received", optional: false },
  { key: "INSPECTION_IN_PROGRESS", label: "Inspection in progress", optional: false },
  { key: "INSPECTION_COMPLETED", label: "Inspection completed", optional: false },
  { key: "ESTIMATE_AWAITING_APPROVAL", label: "Estimate awaiting approval", optional: true },
  { key: "APPROVAL_RECEIVED", label: "Customer approval received", optional: true },
  { key: "PARTS_CHECKED", label: "Spare-part availability checked", optional: true },
  { key: "PARTS_BEING_ARRANGED", label: "Parts being arranged", optional: true },
  { key: "PARTS_ISSUED", label: "Parts issued", optional: true },
  { key: "REPAIR_IN_PROGRESS", label: "Repair in progress", optional: false },
  { key: "QUALITY_INSPECTION", label: "Quality inspection", optional: false },
  { key: "TEST_RIDE", label: "Test ride", optional: true },
  { key: "FINAL_BILLING", label: "Final billing", optional: false },
  { key: "READY_FOR_DELIVERY", label: "Ready for delivery", optional: false },
  { key: "DELIVERED", label: "Vehicle delivered", optional: false },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];
export type StageState = "COMPLETED" | "ACTIVE" | "BLOCKED" | "FAILED" | "INFO" | "PENDING";

export const PART_UNAVAILABLE_CUSTOMER_MESSAGE =
  "One or more required spare parts are currently unavailable. Our team is arranging the parts, and your service advisor will update you with the expected availability and revised delivery time.";

export const JOB_STATUS_LABEL: Record<string, string> = {
  RECEIVED: "Received",
  INSPECTION: "Inspection",
  AWAITING_APPROVAL: "Awaiting approval",
  APPROVED: "Approved",
  PARTS_PENDING: "Parts pending",
  IN_REPAIR: "In repair",
  QUALITY_CHECK: "Quality check",
  FINAL_BILLING: "Final billing",
  READY_FOR_DELIVERY: "Ready for delivery",
  DELIVERED: "Delivered",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Administrator",
  BRANCH_MANAGER: "Branch Manager",
  SERVICE_ADVISOR: "Service Advisor",
  BILLING_EXECUTIVE: "Billing Executive",
  MECHANIC: "Technician",
  QUALITY_INSPECTOR: "Quality Inspector",
  WAREHOUSE_EXECUTIVE: "Parts Team",
  SALES_EXECUTIVE: "Sales Executive",
};

export interface TimelineEvent {
  stage: string;
  state: string;
  title: string;
  occurredAt: Date;
}

/**
 * Collapse the append-only event log into one entry per stage. Optional stages without
 * events are hidden; mandatory future stages show as PENDING.
 */
export function buildStageView(events: TimelineEvent[], jobStatus: string) {
  const latest = new Map<string, TimelineEvent>();
  const first = new Map<string, TimelineEvent>();
  for (const e of [...events].sort((a, b) => +a.occurredAt - +b.occurredAt)) {
    if (!first.has(e.stage)) first.set(e.stage, e);
    if (e.state !== "INFO" || !latest.has(e.stage)) latest.set(e.stage, e);
  }
  const cancelled = jobStatus === "CANCELLED";
  const order = STAGES.map((s) => s.key as string);
  const lastReached = Math.max(-1, ...[...latest.keys()].map((k) => order.indexOf(k)));
  return STAGES.filter((s) => latest.has(s.key) || (!s.optional && !cancelled)).map((s) => {
    const ev = latest.get(s.key);
    return {
      key: s.key,
      label: s.label,
      // An "active" stage is finished once a later stage has started (e.g. inspection → estimate).
      state: (ev ? (ev.state === "INFO" || ev.state === "ACTIVE" ? (order.indexOf(s.key) < lastReached ? "COMPLETED" : "ACTIVE") : ev.state) : "PENDING") as StageState,
      startedAt: first.get(s.key)?.occurredAt ?? null,
      updatedAt: ev?.occurredAt ?? null,
      title: ev?.title ?? null,
    };
  });
}
