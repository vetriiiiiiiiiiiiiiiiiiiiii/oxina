"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Notice, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/client";
import { cn, fmtMinutes, fmtMoney } from "@/lib/utils";

type Line = { id: string; type: string; description: string; quantity: number; lineTotal: string; isOptional: boolean; approvalStatus: string; repairTaskId: string | null };
type Est = { id: string; estimateNumber: string; kind: string; labourTotal: string; partsTotal: string; discountTotal: string; taxTotal: string; grandTotal: string; customerNote: string | null; lines: Line[] };

/** Approve or decline each recommended repair (parts follow their repair). */
export function EstimateApproval({ estimate, proposed = {} }: { estimate: Est; proposed?: Record<string, { why: string | null; safety: boolean; min: number; max: number }> }) {
  const router = useRouter();
  const toast = useToast();
  const pending = estimate.lines.filter((l) => l.approvalStatus === "PENDING");
  const groups = new Map<string, Line[]>();
  for (const l of pending) groups.set(l.repairTaskId ?? l.id, [...(groups.get(l.repairTaskId ?? l.id) ?? []), l]);
  const [choice, setChoice] = React.useState<Record<string, "APPROVED" | "REJECTED">>(Object.fromEntries([...groups.keys()].map((k) => [k, "APPROVED"])));
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const total = [...groups.entries()].filter(([k]) => choice[k] === "APPROVED").flatMap(([, ls]) => ls).reduce((s, l) => s + Number(l.lineTotal), 0);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const decisions = [...groups.entries()].flatMap(([k, ls]) => ls.map((l) => ({ lineId: l.id, decision: choice[k] })));
      await apiFetch(`/api/service/estimates/${estimate.id}/decision`, { body: { channel: "PORTAL", decisions } });
      toast({ tone: "ok", text: "Thank you — your decision has been sent to the service centre." });
      router.refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Network error.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="border-l-[3px] border-l-warn-600">
      <CardHeader title={estimate.kind === "SUPPLEMENTARY" ? "Additional work needs your approval" : "Your estimate is ready"} description={`${estimate.estimateNumber} · Chargeable work starts only after you approve.`} />
      <CardBody className="space-y-4">
        {estimate.customerNote && <Notice>{estimate.customerNote}</Notice>}
        <ul className="space-y-3">
          {[...groups.entries()].map(([k, ls]) => {
            const head = ls.find((l) => l.type === "LABOUR") ?? ls[0];
            const sum = ls.reduce((s, l) => s + Number(l.lineTotal), 0);
            const optional = ls.some((l) => l.isOptional);
            return (
              <li key={k} className="rounded-[3px] border border-line p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{head.description}{optional && <span className="ml-1.5 rounded bg-canvas px-1.5 text-[10px] uppercase text-muted">optional</span>}</p>
                    {proposed[k]?.why && <p className="mt-0.5 text-[13px]">{proposed[k].why}</p>}
                    {proposed[k]?.safety && <p className="text-[12px] text-bad-700">Affects riding safety</p>}
                    <ul className="mt-1 text-xs text-muted">{ls.map((l) => <li key={l.id}>{l.type === "LABOUR" ? "Labour" : `${l.description.replace(/\s*\([^)]*\)\s*$/, "")} × ${l.quantity}`} — {fmtMoney(l.lineTotal)}</li>)}</ul>
                    {proposed[k] && <p className="mt-0.5 text-xs text-muted">Adds about {proposed[k].min === proposed[k].max ? fmtMinutes(proposed[k].min) : `${fmtMinutes(proposed[k].min)}–${fmtMinutes(proposed[k].max)}`} of workshop time</p>}
                  </div>
                  <p className="whitespace-nowrap text-sm font-semibold tabular-nums">{fmtMoney(sum)}</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(["APPROVED", "REJECTED"] as const).map((d) => (
                    <button key={d} type="button" onClick={() => setChoice({ ...choice, [k]: d })} className={cn("rounded-[3px] border py-2 text-sm font-medium", choice[k] === d ? (d === "APPROVED" ? "border-ok-600 bg-ok-50 text-ok-700" : "border-bad-600 bg-bad-50 text-bad-700") : "border-line text-muted")}>
                      {d === "APPROVED" ? "Approve" : "Decline"}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between border-t border-line pt-3 text-sm"><span className="text-muted">Total you are approving (incl. tax)</span><span className="text-lg font-semibold tabular-nums">{fmtMoney(total)}</span></div>
        {err && <Notice tone="bad">{err}</Notice>}
        <Button size="lg" className="w-full" loading={busy} onClick={submit}>Submit decision</Button>
      </CardBody>
    </Card>
  );
}

export function FeedbackForm({ jobId }: { jobId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [rating, setRating] = React.useState(0);
  const [comments, setComments] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <Card>
      <CardHeader title="How was your service?" />
      <CardBody className="space-y-3">
        <div>
          <p className="mb-1 text-[13px] text-muted">1 = poor, 5 = excellent</p>
          <div className="flex" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rating === n} onClick={() => setRating(n)} className={cn("-ml-px h-9 w-11 border font-mono text-sm first:ml-0", rating === n ? "relative z-10 border-navy-900 bg-navy-900 text-white" : "border-line-strong bg-white hover:bg-shade")}>{n}</button>
            ))}
          </div>
        </div>
        <Textarea value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Tell us what went well or what we can improve (optional)" />
        <Button disabled={!rating} loading={busy} onClick={async () => {
          setBusy(true);
          try {
            await apiFetch(`/api/service/jobs/${jobId}/feedback`, { body: { rating, comments: comments || undefined } });
            toast({ tone: "ok", text: "Thank you for your feedback!" });
            router.refresh();
          } catch (e) {
            toast({ tone: "bad", text: e instanceof ApiError ? e.message : "Network error." });
          } finally {
            setBusy(false);
          }
        }}>Submit feedback</Button>
      </CardBody>
    </Card>
  );
}

export function PhotoLink({ fileId, label }: { fileId: string; label: string }) {
  return (
    <Button size="sm" variant="outline" onClick={async () => {
      const { url } = await apiFetch<{ url: string }>(`/api/files/${fileId}/link`, { body: {} });
      window.open(url, "_blank", "noopener");
    }}>{label}</Button>
  );
}
