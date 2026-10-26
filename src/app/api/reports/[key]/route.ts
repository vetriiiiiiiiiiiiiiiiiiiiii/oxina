import { z } from "zod";
import { api } from "@/lib/api";
import { invalid } from "@/lib/errors";
import { requirePermission } from "@/lib/rbac/actor";
import { REPORTS, rangeQuery, runReport, toCsv, type ReportKey } from "@/lib/services/reports";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";

export const GET = api({ query: rangeQuery.extend({ format: z.enum(["json", "csv"]).default("json") }) }, async ({ actor, query, params }) => {
  if (!(params.key in REPORTS)) throw invalid("Unknown report.");
  const { format, ...range } = query;
  const report = await runReport(actor, params.key as ReportKey, range);
  if (format === "json") return report;
  requirePermission(actor, "reports.export");
  await audit(prisma, { actorId: actor.userId, action: "report.export", entityType: "Report", entityId: params.key, branchId: range.branchId ?? null, after: { rows: report.rows.length, ...range } });
  return new Response("\uFEFF" + toCsv(report.columns, report.rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="oxina-${params.key}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
});
