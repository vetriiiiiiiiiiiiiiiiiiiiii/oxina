"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useModalClose } from "@/components/ui/modal";
import { apiFetch, ApiError } from "@/lib/client";

type Opt = { value: string; label: string; cost?: number };
type HeaderField = { name: string; label: string; type?: "text" | "date" | "select"; options?: Opt[]; required?: boolean };

/** Header fields + item lines (item, quantity, optional unit cost). Used for POs, receipts and transfers. */
export function LinesForm({ url, headerFields, items, withCost = false, fixed, submitLabel, onDone }: {
  url: string;
  headerFields: HeaderField[];
  items: Opt[];
  withCost?: boolean;
  fixed?: Record<string, unknown>;
  submitLabel: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const closeModal = useModalClose();
  const [head, setHead] = React.useState<Record<string, string>>({});
  const [lines, setLines] = React.useState([{ itemId: "", quantity: "1", unitCost: "" }]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const missing = headerFields.find((f) => f.required && !head[f.name]);
    if (missing) return setErr(`${missing.label} is required.`);
    const ls = lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), ...(withCost ? { unitCost: Number(l.unitCost || 0) } : {}) }));
    if (!ls.length) return setErr("Add at least one item.");
    setBusy(true);
    try {
      const body: Record<string, unknown> = { ...fixed, lines: ls };
      for (const f of headerFields) if (head[f.name]) body[f.name] = head[f.name];
      await apiFetch(url, { body });
      toast({ tone: "ok", text: "Saved." });
      onDone?.();
      closeModal?.();
      router.refresh();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Network error.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        {headerFields.map((f) => (
          <Field key={f.name} label={f.label} required={f.required}>
            {f.type === "select" ? (
              <Select value={head[f.name] ?? ""} onChange={(e) => setHead({ ...head, [f.name]: e.target.value })}><option value="">Select…</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
            ) : (
              <Input type={f.type ?? "text"} value={head[f.name] ?? ""} onChange={(e) => setHead({ ...head, [f.name]: e.target.value })} />
            )}
          </Field>
        ))}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted">Items</p>
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <Select className="flex-1" value={l.itemId} onChange={(e) => { const it = items.find((x) => x.value === e.target.value); const n = [...lines]; n[i] = { ...l, itemId: e.target.value, unitCost: it?.cost !== undefined ? String(it.cost) : l.unitCost }; setLines(n); }} aria-label="Item">
              <option value="">Select item…</option>
              {items.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Input type="number" min={1} className="w-20" value={l.quantity} onChange={(e) => { const n = [...lines]; n[i] = { ...l, quantity: e.target.value }; setLines(n); }} aria-label="Quantity" />
            {withCost && <Input type="number" min={0} step="0.01" className="w-28" placeholder="Unit cost" value={l.unitCost} onChange={(e) => { const n = [...lines]; n[i] = { ...l, unitCost: e.target.value }; setLines(n); }} aria-label="Unit cost" />}
            <button type="button" className="rounded-[3px] p-2 text-faint hover:text-bad-600" onClick={() => setLines(lines.filter((_, k) => k !== i))} aria-label="Remove line"></button>
          </div>
        ))}
        <button type="button" onClick={() => setLines([...lines, { itemId: "", quantity: "1", unitCost: "" }])} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600">Add line</button>
      </div>
      <div className="flex justify-end"><Button type="submit" loading={busy}>{submitLabel}</Button></div>
    </form>
  );
}
