import { requireStaffPage } from "@/lib/auth/current";
import { can, requirePermission } from "@/lib/rbac/actor";
import { selectedBranchId } from "@/lib/branch-context";
import { REPORTS, allowedReports, rangeQuery, runReport, type ReportKey } from "@/lib/services/reports";
import { Card, CardHeader, EmptyState, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { RangeFilter } from "@/components/shell/range-filter";
import { AppError } from "@/lib/errors";
import { cn } from "@/lib/utils";

export const metadata = { title: "Reports & Analytics" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const actor = await requireStaffPage();
  requirePermission(actor, "reports.view");
  const sp = await searchParams;
  const allowed = allowedReports(actor);
  if (!allowed.length) return <PageHeader title="Reports" description="No reports are set up for your role." />;
  const key = (allowed.includes(sp.report as ReportKey) ? sp.report : allowed[0]) as ReportKey;
  const branchId = await selectedBranchId(actor);
  const q = rangeQuery.parse({ ...sp, branchId });
  let data: Awaited<ReturnType<typeof runReport>> | null = null;
  let error: string | null = null;
  try {
    data = await runReport(actor, key, q);
  } catch (e) {
    if (e instanceof AppError) error = e.message;
    else throw e;
  }
  const qs = new URLSearchParams({ ...sp, report: key });
  const csv = `/api/reports/${key}?${new URLSearchParams({ preset: q.preset, ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}), ...(branchId ? { branchId } : {}), format: "csv" })}`;
  return (
    <>
      <PageHeader title="Reports" actions={<RangeFilter />} />
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <Card className="h-fit p-2">
          {allowed.map((k) => [k, REPORTS[k]] as const).map(([k, label]) => {
            const p = new URLSearchParams(qs);
            p.set("report", k);
            return <a key={k} href={`/reports?${p}`} className={cn("block rounded-[3px] px-3 py-2 text-sm", k === key ? "bg-navy-900 text-white" : "text-muted hover:bg-canvas hover:text-ink")}>{label}</a>;
          })}
        </Card>
        <Card className="min-w-0">
          <CardHeader title={data?.title ?? REPORTS[key]} description={data ? `${data.rows.length} row(s)` : undefined} action={data && can(actor, "reports.export") && <a href={csv} className="inline-flex h-8 items-center gap-1 rounded-[3px] border border-line px-3 text-xs font-medium hover:bg-canvas">Export CSV</a>} />
          {error ? <div className="p-5"><Notice tone="warn">{error}</Notice></div> : data && data.rows.length ? (
            <Table>
              <thead><tr>{data.columns.map((c) => <Th key={c}>{c.replace(/_/g, " ")}</Th>)}</tr></thead>
              <tbody>{data.rows.slice(0, 500).map((r, i) => <tr key={i}>{data!.columns.map((c) => <Td key={c} className={typeof r[c] === "number" ? "text-right tabular-nums" : "text-xs"}>{r[c] === null ? "—" : typeof r[c] === "number" ? Number(r[c]).toLocaleString("en-IN") : String(r[c])}</Td>)}</tr>)}</tbody>
            </Table>
          ) : <EmptyState title="No data for this period" />}
        </Card>
      </div>
    </>
  );
}
