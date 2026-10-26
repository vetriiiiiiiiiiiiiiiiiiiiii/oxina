/** Default templates; editable copies live in NotificationTemplate (Settings → Templates). */
export const DEFAULT_TEMPLATES: { key: string; channel: string; subject?: string; body: string }[] = [
  {
    key: "PART_UNAVAILABLE",
    channel: "EMAIL",
    subject: "Update on your {{vehicle_model}} service ({{job_number}})",
    body:
      "Hello {{customer_name}}, during the service of your {{vehicle_model}}, we identified that {{part_name}} is currently unavailable. Our team is arranging the required part and will update you once availability is confirmed. Your estimated completion time is currently {{estimated_completion}}. We apologise for the inconvenience. For assistance, please contact {{service_advisor_name}} at {{branch_contact}}.",
  },
  {
    key: "READY_FOR_DELIVERY",
    channel: "EMAIL",
    subject: "Your {{vehicle_model}} is ready for collection",
    body:
      "Hello {{customer_name}}, your {{vehicle_model}} has completed the required repairs and quality checks. Your vehicle is ready for collection at {{branch_name}}. Please review your final invoice and contact {{service_advisor_name}} if you need any assistance.",
  },
  {
    key: "ESTIMATE_READY",
    channel: "EMAIL",
    subject: "Estimate ready for your {{vehicle_model}} ({{job_number}})",
    body:
      "Hello {{customer_name}}, the estimate for your {{vehicle_model}} is ready for your review. Total estimated cost: {{estimate_total}}. Please review and approve it in your customer portal, or contact {{service_advisor_name}} at {{branch_contact}}.",
  },
  {
    key: "JOB_CREATED",
    channel: "EMAIL",
    subject: "We've received your {{vehicle_model}} ({{job_number}})",
    body:
      "Hello {{customer_name}}, we have received your {{vehicle_model}} at {{branch_name}}. Your job number is {{job_number}}. You can follow progress in your customer portal. Your service advisor is {{service_advisor_name}} ({{branch_contact}}).",
  },
  {
    key: "ETA_CHANGED",
    channel: "EMAIL",
    subject: "Updated completion time for your {{vehicle_model}}",
    body: "Hello {{customer_name}}, the estimated completion time for your {{vehicle_model}} is now {{estimated_completion}}. Contact {{service_advisor_name}} at {{branch_contact}} for details.",
  },
  {
    key: "VEHICLE_DELIVERED",
    channel: "EMAIL",
    subject: "Thank you for servicing your {{vehicle_model}} with us",
    body: "Hello {{customer_name}}, your {{vehicle_model}} was handed over on {{delivered_at}}. We'd value your feedback in the customer portal.",
  },
];

/** Replace {{placeholders}}. Missing values render as an em dash — never a fabricated value. */
export function renderTemplate(body: string, values: Record<string, string | null | undefined>) {
  return body.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, k: string) => {
    const v = values[k];
    return v === undefined || v === null || v === "" ? "—" : String(v);
  });
}
