"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/client";

export function AuditCount({ auditId, items }: { auditId: string; items: { id: string; label: string; system: number }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [c, setC] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="rounded-[3px] border border-line p-3">
      <p className="mb-2 text-xs text-muted">Enter counted quantities (blind count: system quantity is hidden until completion).</p>
      <div className="grid gap-2 sm:grid-cols-2">{items.map((i) => <label key={i.id} className="flex items-center justify-between gap-2 text-xs"><span className="truncate">{i.label}</span><Input type="number" min={0} className="h-8 w-20" value={c[i.id] ?? ""} onChange={(e) => setC({ ...c, [i.id]: e.target.value })} /></label>)}</div>
      <div className="mt-3 flex justify-end"><Button size="sm" loading={busy} onClick={async () => {
        const counts = Object.entries(c).filter(([, v]) => v !== "").map(([itemId, v]) => ({ itemId, countedQty: Number(v) }));
        if (!counts.length) return toast({ tone: "bad", text: "Enter at least one count." });
        if (!confirm("Complete the audit? Variances will be posted as stock adjustments.")) return;
        setBusy(true);
        try {
          const res = await apiFetch<{ variance: number }[]>(`/api/inventory/audits/${auditId}/complete`, { body: { counts } });
          toast({ tone: "ok", text: `Audit complete: ${res.filter((r) => r.variance !== 0).length} variance(s) posted.` });
          router.refresh();
        } catch (e) {
          toast({ tone: "bad", text: e instanceof ApiError ? e.message : "Failed." });
        } finally {
          setBusy(false);
        }
      }}>Complete audit</Button></div>
    </div>
  );
}
