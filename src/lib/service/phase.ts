/** Job statuses grouped into six phases for charts (nine separate hues would be unreadable). */
export const PHASES = [
  { key: "start", label: "Not started", color: "#8d9096", statuses: ["RECEIVED", "INSPECTION"] },
  { key: "customer", label: "With customer", color: "var(--color-dept-parts)", statuses: ["AWAITING_APPROVAL"] },
  { key: "parts", label: "Waiting parts", color: "var(--color-dept-showroom)", statuses: ["PARTS_PENDING"] },
  { key: "work", label: "In work", color: "var(--color-dept-workshop)", statuses: ["APPROVED", "IN_REPAIR"] },
  { key: "finish", label: "Checks & billing", color: "var(--color-dept-people)", statuses: ["QUALITY_CHECK", "FINAL_BILLING"] },
  { key: "ready", label: "Ready", color: "var(--color-dept-money)", statuses: ["READY_FOR_DELIVERY"] },
] as const;

export const phaseOf = (status: string) => PHASES.find((p) => (p.statuses as readonly string[]).includes(status));
