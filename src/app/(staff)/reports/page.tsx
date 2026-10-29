import { requireStaffPage } from "@/lib/auth/current";
import { can, requirePermission } from "@/lib/rbac/actor";
import { selectedBranchId } from "@/lib/branch-context";
import { REPORTS, allowedReports, rangeQuery, runReport, type ReportKey } from "@/lib/services/reports";
import { Card, CardHeader, EmptyState, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { RangeFilter } from "@/components/shell/range-filter";
import { AppError } from "@/lib/errors";
import { cn, fmtMoney } from "@/lib/utils";
import { BarList } from "@/components/visual/segment-bar";

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
          {data && data.rows.length > 1 && (() => {
            // Chart the first numeric column against the first text column, when the report has one.
            const numCol = data.columns.find((c) => data.rows.some((r) => typeof r[c] === "number"));
            const labelCol = data.columns.find((c) => c !== numCol && data.rows.every((r) => typeof r[c] === "string" || r[c] === null));
            if (!numCol || !labelCol) return null;
            const money = /revenue|sales|service|total|balance|value|paid|collected|claimed|reimbursed|tax/i.test(numCol);
            const rows = [...data.rows].filter((r) => typeof r[numCol] === "number").sort((a, b) => Number(b[numCol]) - Number(a[numCol])).slice(0, 10);
            return (
              <div className="border-b border-line px-4 py-3">
                <p className="mb-2 text-[12px] text-muted">{numCol.replace(/_/g, " ")} by {labelCol.replace(/_/g, " ")}{data.rows.length > 10 ? " — top 10" : ""}</p>
                <BarList color="var(--dept, var(--color-dept-workshop))" format={money ? (n) => fmtMoney(n) : undefined} rows={rows.map((r) => ({ label: String(r[labelCol] ?? "—"), value: Number(r[numCol]) }))} />
              </div>
            );
          })()}
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
