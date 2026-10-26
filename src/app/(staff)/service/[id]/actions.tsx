"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { Button, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { SimpleForm } from "@/components/forms/simple-form";
import { apiFetch, ApiError } from "@/lib/client";
import { fmtMoney } from "@/lib/utils";

function useRun() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const run = async (url: string, body: unknown, ok: string, after?: () => void) => {
    setBusy(true);
    try {
      await apiFetch(url, { body });
      toast({ tone: "ok", text: ok });
      after?.();
      router.refresh();
      return true;
    } catch (e) {
      toast({ tone: "bad", text: e instanceof ApiError ? e.message : "Network error." });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

// ─── Inspection / supplementary work builder ───

type ItemOpt = { id: string; label: string; price: number; compatible: string[] };
type DurOpt = { key: string; label: string; min: number; max: number; labour: number };
type TaskForm = { title: string; taskKey: string; minMinutes: number; maxMinutes: number; labourCharge: number; isOptional: boolean; isSafetyCritical: boolean; dependsOn: string; parts: { itemId: string; quantity: number }[] };
type InspForm = { findings: string; customerSummary: string; internalNotes: string; safetyCritical: boolean; reason: string; checklist: { key: string; label: string; result: string }[]; tasks: TaskForm[] };

const CHECKS = [["engine", "Engine & oil"], ["brakes", "Brakes"], ["tyres", "Tyres"], ["chain", "Chain & sprockets"], ["electrical", "Electrical & lights"], ["battery", "Battery"], ["suspension", "Suspension"], ["clutch", "Clutch & gearbox"]];

export function InspectionForm({ jobId, items, durations, model, mode }: { jobId: string; items: ItemOpt[]; durations: DurOpt[]; model: string; mode: "inspection" | "supplementary" }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(mode === "inspection");
  const [err, setErr] = React.useState<string | null>(null);
  const { register, control, handleSubmit, setValue, watch, formState } = useForm<InspForm>({
    defaultValues: { checklist: CHECKS.map(([key, label]) => ({ key, label, result: "OK" })), tasks: [], safetyCritical: false },
  });
  const tasks = useFieldArray({ control, name: "tasks" });
  const watched = watch("tasks");
  const modelBase = model.replace(/\s+(Signals|Chrome|Metro|Standard|Fireball|Astral|Flash|Kaza Brown)$/i, "");
  const sortedItems = [...items].sort((a, b) => Number(b.compatible.some((c) => modelBase.startsWith(c))) - Number(a.compatible.some((c) => modelBase.startsWith(c))));
  const total = (watched ?? []).reduce((s, t) => s + Number(t.labourCharge || 0) + (t.parts ?? []).reduce((p, x) => p + (items.find((i) => i.id === x.itemId)?.price ?? 0) * Number(x.quantity || 0), 0), 0);

  if (!open) return <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Propose additional work</Button>;

  return (
    <form
      noValidate
      className="space-y-5 rounded-[3px] border border-brand-200 bg-shade p-4"
      onSubmit={handleSubmit(async (v) => {
        setErr(null);
        const tasksBody = v.tasks.map((t, i) => ({
          title: t.title, taskKey: t.taskKey || undefined, minMinutes: Number(t.minMinutes) || undefined, maxMinutes: Number(t.maxMinutes) || undefined,
          labourCharge: Number(t.labourCharge || 0), isOptional: !!t.isOptional, isSafetyCritical: !!t.isSafetyCritical,
          dependsOn: t.dependsOn !== "" && t.dependsOn !== undefined && Number(t.dependsOn) !== i ? [Number(t.dependsOn)] : [],
          parts: (t.parts ?? []).filter((p) => p.itemId).map((p) => ({ itemId: p.itemId, quantity: Number(p.quantity) })),
        }));
        try {
          if (mode === "inspection") {
            await apiFetch(`/api/service/jobs/${jobId}/inspection`, { body: { checklist: v.checklist, findings: v.findings || undefined, customerSummary: v.customerSummary || undefined, internalNotes: v.internalNotes || undefined, safetyCritical: !!v.safetyCritical, tasks: tasksBody } });
            toast({ tone: "ok", text: "Inspection completed. Review and send the estimate." });
          } else {
            await apiFetch(`/api/service/jobs/${jobId}/supplementary`, { body: { reason: v.reason, tasks: tasksBody } });
            toast({ tone: "ok", text: "Supplementary estimate drafted. Send it to the customer for approval." });
            setOpen(false);
          }
          router.refresh();
        } catch (e) {
          setErr(e instanceof ApiError ? e.message : "Network error.");
        }
      })}
    >
      <div className="flex items-center justify-between"><h4 className="text-sm font-semibold">{mode === "inspection" ? "Record inspection findings" : "Additional work found during repair"}</h4>{mode === "supplementary" && <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Button>}</div>
      {mode === "inspection" ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {CHECKS.map(([, label], i) => (
              <Field key={i} label={label}>
                <Select {...register(`checklist.${i}.result` as const)}><option value="OK">OK</option><option value="ATTENTION">Needs attention</option><option value="FAIL">Fail</option><option value="NA">N/A</option></Select>
              </Field>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Findings (internal)"><Textarea {...register("findings")} /></Field>
            <Field label="Summary for the customer" hint="Shown in the customer portal"><Textarea {...register("customerSummary")} /></Field>
            <Field label="Internal notes" hint="Never shown to customers"><Textarea {...register("internalNotes")} /></Field>
            <label className="flex items-center gap-2 self-center text-sm"><input type="checkbox" className="size-4 accent-brand-600" {...register("safetyCritical")} /> Safety-critical findings</label>
          </div>
        </>
      ) : (
        <Field label="Why is this work needed?" required error={formState.errors.reason?.message}><Textarea {...register("reason", { required: "Explain the additional work." })} /></Field>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between"><p className="text-sm font-medium">Recommended repairs</p><span className="text-xs text-muted">Estimated before tax: <b>{fmtMoney(total)}</b></span></div>
        {tasks.fields.map((f, i) => (
          <TaskRow key={f.id} index={i} register={register} control={control} items={sortedItems} durations={durations} others={watched.map((t, k) => ({ k, title: t.title })).filter((x) => x.k !== i)} remove={() => tasks.remove(i)}
            onPickStd={(d) => { setValue(`tasks.${i}.title`, d.label); setValue(`tasks.${i}.minMinutes`, d.min); setValue(`tasks.${i}.maxMinutes`, d.max); setValue(`tasks.${i}.labourCharge`, d.labour); }} />
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => tasks.append({ title: "", taskKey: "", minMinutes: 30, maxMinutes: 60, labourCharge: 0, isOptional: false, isSafetyCritical: false, dependsOn: "", parts: [] })}>Add repair task</Button>
        {mode === "inspection" && !tasks.fields.length && <p className="text-xs text-muted">No tasks? Completing the inspection without tasks moves the job to final billing.</p>}
      </div>
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="flex justify-end"><Button type="submit" loading={formState.isSubmitting} disabled={mode === "supplementary" && !tasks.fields.length}>{mode === "inspection" ? "Complete inspection & draft estimate" : "Draft supplementary estimate"}</Button></div>
    </form>
  );
}

function TaskRow({ index, register, control, items, durations, others, remove, onPickStd }: {
  index: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: any; control: any;
  items: ItemOpt[]; durations: DurOpt[]; others: { k: number; title: string }[]; remove: () => void; onPickStd: (d: DurOpt) => void;
}) {
  const parts = useFieldArray({ control, name: `tasks.${index}.parts` });
  return (
    <div className="rounded-[3px] border border-line bg-white p-3">
      <div className="grid gap-2 md:grid-cols-[1.2fr_1.6fr_auto]">
        <Field label="Standard task">
          <Select {...register(`tasks.${index}.taskKey`)} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { const d = durations.find((x) => x.key === e.target.value); if (d) onPickStd(d); register(`tasks.${index}.taskKey`).onChange(e); }}>
            <option value="">Custom</option>
            {durations.filter((d) => !["QUALITY_INSPECTION", "TEST_RIDE", "FINAL_BILLING", "VEHICLE_INTAKE", "ESTIMATE_PREPARATION", "PART_PICKING", "BASIC_INSPECTION"].includes(d.key)).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </Select>
        </Field>
        <Field label="Task title"><Input {...register(`tasks.${index}.title`, { required: true })} /></Field>
        <button type="button" onClick={remove} className="mt-6 self-start rounded-[3px] p-2 text-faint hover:bg-bad-50 hover:text-bad-600" aria-label="Remove task">Remove</button>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Min (min)"><Input type="number" min={5} {...register(`tasks.${index}.minMinutes`)} /></Field>
        <Field label="Max (min)"><Input type="number" min={5} {...register(`tasks.${index}.maxMinutes`)} /></Field>
        <Field label="Labour ₹"><Input type="number" min={0} {...register(`tasks.${index}.labourCharge`)} /></Field>
        <Field label="Starts after"><Select {...register(`tasks.${index}.dependsOn`)}><option value="">— none —</option>{others.map((o) => <option key={o.k} value={o.k}>{o.title || `Task ${o.k + 1}`}</option>)}</Select></Field>
        <label className="flex items-center gap-2 pt-6 text-xs"><input type="checkbox" className="accent-brand-600" {...register(`tasks.${index}.isOptional`)} /> Optional</label>
        <label className="flex items-center gap-2 pt-6 text-xs"><input type="checkbox" className="accent-brand-600" {...register(`tasks.${index}.isSafetyCritical`)} /> Safety-critical</label>
      </div>
      <div className="mt-2 space-y-2">
        {parts.fields.map((p, k) => (
          <div key={p.id} className="flex gap-2">
            <Select className="flex-1" {...register(`tasks.${index}.parts.${k}.itemId`, { required: true })}>
              <option value="">Select part…</option>
              {items.map((it) => <option key={it.id} value={it.id}>{it.label} — {fmtMoney(it.price)}</option>)}
            </Select>
            <Input type="number" min={1} className="w-20" {...register(`tasks.${index}.parts.${k}.quantity`)} aria-label="Quantity" />
            <button type="button" onClick={() => parts.remove(k)} className="rounded-[3px] p-2 text-faint hover:text-bad-600" aria-label="Remove part"></button>
          </div>
        ))}
        <button type="button" onClick={() => parts.append({ itemId: "", quantity: 1 })} className="text-xs font-medium text-brand-600 hover:underline">+ Add spare part</button>
      </div>
    </div>
  );
}

// ─── Estimates ───

export function DiscountEditor({ lineId, value }: { lineId: string; value: number }) {
  const { run, busy } = useRun();
  const [v, setV] = React.useState(String(value));
  return (
    <form className="inline-flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); run(`/api/service/estimates/lines/${lineId}`, { discount: Number(v) }, "Discount updated."); }}>
      <input value={v} onChange={(e) => setV(e.target.value)} type="number" min={0} className="h-7 w-20 rounded border border-line px-1 text-right text-xs" aria-label="Discount" />
      {Number(v) !== value && <Button size="sm" variant="outline" loading={busy} className="h-7 px-2">Save</Button>}
    </form>
  );
}

export function SendEstimate({ estimateId }: { estimateId: string }) {
  return (
    <Modal trigger="Send to customer" title="Send estimate for approval" description="The customer is notified and can approve in their portal." triggerProps={{ variant: "primary" }}>
      {(close) => <SimpleForm url={`/api/service/estimates/${estimateId}/send`} columns={1} submitLabel="Send estimate" successMessage="Estimate sent." onDone={close} fields={[{ name: "note", label: "Note to customer (optional)", type: "textarea" }]} />}
    </Modal>
  );
}

export function DecisionRecorder({ estimateId, lines }: { estimateId: string; lines: { id: string; description: string; type: string; total: number; optional: boolean }[] }) {
  const { run, busy } = useRun();
  const [d, setD] = React.useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, "APPROVED"])));
  const [channel, setChannel] = React.useState("IN_PERSON");
  const [notes, setNotes] = React.useState("");
  return (
    <Modal trigger="Record customer decision" title="Record approval given in person or by phone" description="Use only when the customer approved outside the portal. This is audited." wide>
      {(close) => (
        <div className="space-y-4">
          <ul className="divide-y divide-line rounded-[3px] border border-line">
            {lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>{l.description} <span className="text-xs text-muted">· {l.type.toLowerCase()}{l.optional ? " · optional" : ""} · {fmtMoney(l.total)}</span></span>
                <Select className="w-36" value={d[l.id]} onChange={(e) => setD({ ...d, [l.id]: e.target.value })}><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></Select>
              </li>
            ))}
          </ul>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Channel"><Select value={channel} onChange={(e) => setChannel(e.target.value)}><option value="IN_PERSON">In person</option><option value="PHONE">Phone</option></Select></Field>
            <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Approved on call at 11:40" /></Field>
          </div>
          <div className="flex justify-end"><Button loading={busy} onClick={() => run(`/api/service/estimates/${estimateId}/decision`, { channel, notes: notes || undefined, decisions: Object.entries(d).map(([lineId, decision]) => ({ lineId, decision })) }, "Decision recorded.", close)}>Save decision</Button></div>
        </div>
      )}
    </Modal>
  );
}

// ─── Parts ───

export function ProcurementForm({ requestId }: { requestId: string }) {
  return (
    <Modal trigger="Procurement" title="Record procurement" description="How and when will this part arrive? The customer's ETA uses this date.">
      {(close) => <SimpleForm url={`/api/inventory/requests/${requestId}/procurement`} columns={1} submitLabel="Save" successMessage="Procurement recorded; ETA recalculated." onDone={close} fields={[{ name: "expectedAvailableAt", label: "Expected availability", type: "datetime-local", hint: "Leave blank if unknown — no completion time will be promised." }, { name: "note", label: "Note (supplier, PO, transfer…)", type: "textarea" }]} />}
    </Modal>
  );
}

// ─── Tasks ───

export function TaskActions({ task, mechanics, canAssign, isMine, canWork }: { task: { id: string; status: string; version: number; mechanicId: string | null; holdReason?: string | null }; mechanics: { id: string; name: string; code: string | null }[]; canAssign: boolean; isMine: boolean; canWork: boolean }) {
  const { run, busy } = useRun();
  const act = (action: string, needsReason = false) => {
    let reason: string | undefined;
    if (needsReason) {
      reason = window.prompt(action === "PAUSE" ? "Reason for pausing:" : "Reason for blocking:") ?? undefined;
      if (!reason) return;
    }
    run(`/api/service/tasks/${task.id}/transition`, { action, reason, expectedVersion: task.version }, `Task ${action.toLowerCase()}ed.`.replace("eed", "ed"));
  };
  const worker = (isMine && canWork) || canAssign;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canAssign && task.status !== "COMPLETED" && task.status !== "IN_PROGRESS" && (
        <Select className="h-8 w-44 text-xs" defaultValue={task.mechanicId ?? ""} disabled={busy} onChange={(e) => run(`/api/service/tasks/${task.id}/assign`, { mechanicId: e.target.value || null }, "Mechanic assigned.")} aria-label="Assign mechanic">
          <option value="">Unassigned</option>
          {mechanics.map((m) => <option key={m.id} value={m.id}>{m.name}{m.code ? ` (${m.code})` : ""}</option>)}
        </Select>
      )}
      {worker && task.status === "READY" && <Button size="sm" loading={busy} onClick={() => act("START")}>Start</Button>}
      {worker && task.status === "IN_PROGRESS" && <><Button size="sm" variant="outline" loading={busy} onClick={() => act("PAUSE", true)}>Pause</Button><Button size="sm" variant="success" loading={busy} onClick={() => act("COMPLETE")}>Complete</Button></>}
      {worker && task.status === "PAUSED" && <Button size="sm" loading={busy} onClick={() => act("RESUME")}>Resume</Button>}
      {worker && ["READY", "IN_PROGRESS", "PAUSED"].includes(task.status) && <Button size="sm" variant="ghost" loading={busy} onClick={() => act("BLOCK", true)}>Block</Button>}
      {worker && task.status === "BLOCKED" && (task.holdReason?.startsWith("Awaiting spare part")
        ? <span className="text-[12px] text-muted">Starts when the part is issued</span>
        : <Button size="sm" variant="outline" loading={busy} onClick={() => act("UNBLOCK")}>Unblock</Button>)}
    </div>
  );
}

// ─── QC ───

export function TestRideStart({ qcId, odometer }: { qcId: string; odometer: number }) {
  return (
    <Modal trigger="Start test ride" title="Start test ride">
      {(close) => <SimpleForm url={`/api/service/quality/${qcId}/test-ride`} columns={1} submitLabel="Start" successMessage="Test ride started." onDone={close} fields={[{ name: "odometerStart", label: "Odometer at start (km)", type: "number", required: true, defaultValue: odometer }]} />}
    </Modal>
  );
}

export function TestRideEnd({ rideId, odometerStart }: { rideId: string; odometerStart: number }) {
  return (
    <Modal trigger="End test ride" title="Record test-ride result">
      {(close) => <SimpleForm url={`/api/service/test-rides/${rideId}/end`} columns={1} submitLabel="Save" successMessage="Test ride recorded." onDone={close} fields={[{ name: "odometerEnd", label: "Odometer at end (km)", type: "number", required: true, defaultValue: odometerStart }, { name: "result", label: "Result", type: "select", required: true, options: [{ value: "OK", label: "OK" }, { value: "ISSUES_FOUND", label: "Issues found" }] }, { name: "observations", label: "Road-test observations", type: "textarea" }]} />}
    </Modal>
  );
}

export function QcCompleteForm({ qcId, checklist, tasks }: { qcId: string; checklist: { key: string; label: string; mandatory: boolean; safetyCritical: boolean }[]; tasks: { id: string; title: string }[] }) {
  const { run, busy } = useRun();
  const [res, setRes] = React.useState<Record<string, string>>(Object.fromEntries(checklist.map((c) => [c.key, ""])));
  const [ride, setRide] = React.useState(true);
  const [reason, setReason] = React.useState("");
  const [ret, setRet] = React.useState<string[]>([]);
  const submit = (result: "PASSED" | "FAILED") =>
    run(`/api/service/quality/${qcId}/complete`, { result, testRideRequired: ride, checklist: Object.entries(res).filter(([, v]) => v).map(([key, r]) => ({ key, result: r })), failureReason: reason || undefined, returnTaskIds: ret }, result === "PASSED" ? "Quality inspection passed." : "Returned to repair.");
  return (
    <div className="rounded-[3px] border border-line p-3">
      <p className="mb-2 text-xs font-medium text-muted">Quality checklist</p>
      <ul className="space-y-1.5">
        {checklist.map((c) => (
          <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{c.label}{c.mandatory && <span className="text-bad-600"> *</span>}{c.safetyCritical && <span className="ml-1 text-[10px] uppercase text-bad-700">safety</span>}</span>
            <div className="inline-flex rounded-[3px] border border-line">
              {["PASS", "FAIL", "NA"].map((r) => <button key={r} type="button" onClick={() => setRes({ ...res, [c.key]: r })} className={`px-2.5 py-1 text-xs ${res[c.key] === r ? (r === "PASS" ? "bg-ok-600 text-white" : r === "FAIL" ? "bg-bad-600 text-white" : "bg-slate-600 text-white") : "text-muted hover:bg-canvas"}`}>{r}</button>)}
            </div>
          </li>
        ))}
      </ul>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={ride} onChange={(e) => setRide(e.target.checked)} /> Test ride required</label>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Failure reason (if failing)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Field label="Return to task(s)">
          <div className="space-y-1">{tasks.map((t) => <label key={t.id} className="flex items-center gap-2 text-xs"><input type="checkbox" className="accent-brand-600" checked={ret.includes(t.id)} onChange={(e) => setRet(e.target.checked ? [...ret, t.id] : ret.filter((x) => x !== t.id))} /> {t.title}</label>)}</div>
        </Field>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="danger" size="sm" loading={busy} onClick={() => submit("FAILED")}>Fail & return to repair</Button>
        <Button variant="success" size="sm" loading={busy} onClick={() => submit("PASSED")}>Pass inspection</Button>
      </div>
    </div>
  );
}

// ─── Billing & delivery ───

export function PaymentForm({ invoiceId, balance, canConfirm }: { invoiceId: string; balance: number; canConfirm: boolean }) {
  return (
    <Modal trigger="Record payment" title="Record payment" description="Never enter card numbers — record the terminal or UPI transaction reference." triggerProps={{ variant: "primary" }}>
      {(close) => (
        <SimpleForm
          url="/api/payments"
          submitLabel="Record payment"
          successMessage="Payment recorded."
          onDone={close}
          transform={(v) => ({ ...v, invoiceId, confirmNow: canConfirm && !!v.confirmNow })}
          fields={[
            { name: "amount", label: "Amount (₹)", type: "number", required: true, defaultValue: balance, step: "0.01" },
            { name: "method", label: "Method", type: "select", required: true, options: ["CASH", "UPI", "CARD", "BANK_TRANSFER", "CHEQUE", "FINANCE"].map((m) => ({ value: m, label: m.replace("_", " ").toLowerCase() })) },
            { name: "reference", label: "Transaction reference" },
            { name: "notes", label: "Notes" },
            ...(canConfirm ? [{ name: "confirmNow", label: "Payment received and verified — confirm now and issue receipt", type: "checkbox" as const, span: 2 as const }] : []),
          ]}
        />
      )}
    </Modal>
  );
}

export function ReadyForm({ jobId }: { jobId: string }) {
  return (
    <Modal trigger="Mark ready for delivery" title="Mark ready for delivery" description="Requires passed quality checks and a finalized invoice. The customer is notified." triggerProps={{ variant: "success" }}>
      {(close) => <SimpleForm url={`/api/service/jobs/${jobId}/ready`} columns={1} submitLabel="Mark ready & notify" successMessage="Customer notified: vehicle ready." onDone={close} fields={[{ name: "pickupInstructions", label: "Pickup instructions (optional)", type: "textarea" }]} />}
    </Modal>
  );
}

export function HandoverForm({ jobId, odometer, balance }: { jobId: string; odometer: number; balance: number }) {
  return (
    <>
      {balance > 0 && <Notice tone="warn">Outstanding balance {fmtMoney(balance)} — record and confirm payment before handover.</Notice>}
      <Modal trigger="Hand over vehicle" title="Vehicle handover" description="Closes the job once all conditions are met and schedules follow-ups." triggerProps={{ variant: "success" }} wide>
        {(close) => (
          <SimpleForm
            url={`/api/service/jobs/${jobId}/handover`}
            submitLabel="Complete handover"
            successMessage="Vehicle delivered and job closed."
            onDone={close}
            transform={(v) => ({ recipientName: v.recipientName, recipientRelation: v.recipientRelation, odometerOut: v.odometerOut, notes: v.notes, customerAcknowledged: !!v.customerAcknowledged, checklist: { vehicleInspectedWithCustomer: !!v.c1, accessoriesReturned: !!v.c2, invoiceExplained: !!v.c3, oldPartsOffered: !!v.c4 } })}
            fields={[
              { name: "recipientName", label: "Received by", required: true },
              { name: "recipientRelation", label: "Relationship", type: "select", required: true, options: [{ value: "OWNER", label: "Owner" }, { value: "FAMILY", label: "Family member" }, { value: "AUTHORIZED_PERSON", label: "Authorised person" }, { value: "DRIVER", label: "Driver" }] },
              { name: "odometerOut", label: "Final odometer (km)", type: "number", required: true, defaultValue: odometer },
              { name: "notes", label: "Delivery notes" },
              { name: "c1", label: "Vehicle inspected with customer *", type: "checkbox" },
              { name: "c2", label: "Accessories returned *", type: "checkbox" },
              { name: "c3", label: "Invoice & work explained", type: "checkbox" },
              { name: "c4", label: "Replaced parts offered to customer", type: "checkbox" },
              { name: "customerAcknowledged", label: "Customer acknowledges receipt of the vehicle *", type: "checkbox", span: 2 },
            ]}
          />
        )}
      </Modal>
    </>
  );
}

// ─── People ───

export function AssignStaff({ jobId, staff, canManage }: { jobId: string; staff: { id: string; name: string; roles: string[] }[]; canManage: boolean }) {
  const roles = canManage ? [["MECHANIC", "Mechanic"], ["EXAMINER", "Examiner"], ["INSPECTOR", "Quality inspector"], ["BILLING", "Billing"], ["ADVISOR", "Service advisor (replace)"]] : [["MECHANIC", "Mechanic"]];
  return (
    <Modal trigger="Assign staff" title="Assign staff to this job">
      {(close) => <SimpleForm url={`/api/service/jobs/${jobId}/assign`} columns={1} submitLabel="Assign" successMessage="Assigned." onDone={close} fields={[{ name: "role", label: "Role on job", type: "select", required: true, options: roles.map(([value, label]) => ({ value, label })) }, { name: "userId", label: "Employee", type: "select", required: true, options: staff.map((s) => ({ value: s.id, label: `${s.name} — ${s.roles.map((r) => r.toLowerCase().replace(/_/g, " ")).join(", ")}` })) }]} />}
    </Modal>
  );
}

export function CancelJob({ jobId }: { jobId: string }) {
  return (
    <Modal trigger="Cancel job" title="Cancel this service job" description="Only possible before repairs start. Reserved parts are released." triggerProps={{ variant: "ghost" }}>
      {(close) => <SimpleForm url={`/api/service/jobs/${jobId}/cancel`} columns={1} submitLabel="Cancel job" successMessage="Job cancelled." onDone={close} fields={[{ name: "reason", label: "Reason", type: "textarea", required: true }]} />}
    </Modal>
  );
}

export function PhotoUpload({ jobId, branchId, photoIds }: { jobId: string; branchId: string; photoIds: { fileId: string; stage: string; caption: string | null; visible: boolean }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [stage, setStage] = React.useState("INTAKE");
  const [visible, setVisible] = React.useState(false);
  const view = async (fileId: string) => {
    try {
      const { url } = await apiFetch<{ url: string }>(`/api/files/${fileId}/link`, { body: {} });
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast({ tone: "bad", text: e instanceof ApiError ? e.message : "Could not open file." });
    }
  };
  return (
    <div className="space-y-3">
      {photoIds.length > 0 && <ul className="space-y-1 text-xs">{photoIds.map((p) => <li key={p.fileId} className="flex justify-between gap-2"><button className="text-brand-600 hover:underline" onClick={() => view(p.fileId)}>{p.caption || `${p.stage.toLowerCase()} photo`}</button><span className="text-faint">{p.visible ? "customer-visible" : "internal"}</span></li>)}</ul>}
      <div className="flex flex-wrap items-center gap-2">
        <Select className="h-8 w-32 text-xs" value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Photo stage">{["INTAKE", "INSPECTION", "REPAIR", "QUALITY"].map((s) => <option key={s}>{s}</option>)}</Select>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} className="accent-brand-600" /> Show to customer</label>
        <label className={`inline-flex h-8 cursor-pointer items-center gap-1 rounded-[3px] border border-line px-3 text-xs font-medium hover:bg-canvas ${busy ? "opacity-50" : ""}`}>
          Upload
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            try {
              const fd = new FormData();
              fd.append("file", f);
              fd.append("branchId", branchId);
              const res = await fetch("/api/files", { method: "POST", body: fd });
              const j = await res.json();
              if (!j.ok) throw new ApiError(j.error.message, j.error.code);
              await apiFetch(`/api/service/jobs/${jobId}/photos`, { body: { fileId: j.data.id, stage, customerVisible: visible, caption: f.name } });
              toast({ tone: "ok", text: "Photo uploaded." });
              router.refresh();
            } catch (err) {
              toast({ tone: "bad", text: err instanceof ApiError ? err.message : "Upload failed." });
            } finally {
              setBusy(false);
              e.target.value = "";
            }
          }} />
        </label>
      </div>
    </div>
  );
}
