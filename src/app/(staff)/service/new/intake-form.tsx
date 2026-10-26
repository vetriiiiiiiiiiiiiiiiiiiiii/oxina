"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button, Card, CardBody, CardHeader, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/client";

type Found = { id: string; fullName: string; email: string | null; vehicles: { registrationNumber: string; modelName: string; vehicleModelId: string | null }[] } | null;
type V = Record<string, string | boolean>;

export function IntakeForm({ branchId, models, advisors, me }: { branchId: string; models: { id: string; name: string; variant: string }[]; advisors: { id: string; name: string }[]; me: string }) {
  const router = useRouter();
  const toast = useToast();
  const [phone, setPhone] = React.useState("");
  const [found, setFound] = React.useState<Found | undefined>(undefined);
  const [looking, setLooking] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const { register, handleSubmit, setValue, formState, setError } = useForm<V>({ defaultValues: { serviceType: "PERIODIC_SERVICE", fuelLevel: "HALF", serviceAdvisorId: advisors.some((a) => a.id === me) ? me : "" } });

  const lookup = async () => {
    setLooking(true);
    setErr(null);
    try {
      const c = await apiFetch<Found>(`/api/customers/lookup?phone=${encodeURIComponent(phone)}`);
      setFound(c);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Lookup failed");
    } finally {
      setLooking(false);
    }
  };

  const pickVehicle = (reg: string) => {
    const v = found?.vehicles.find((x) => x.registrationNumber === reg);
    if (!v) return;
    setValue("registrationNumber", v.registrationNumber);
    setValue("modelName", v.modelName);
    if (v.vehicleModelId) setValue("vehicleModelId", v.vehicleModelId);
  };

  const submit = handleSubmit(async (v) => {
    setErr(null);
    const model = models.find((m) => m.id === v.vehicleModelId);
    const body = {
      branchId,
      ...(found ? { customerId: found.id, confirmPhone: phone } : { newCustomer: { fullName: v.fullName, phone, email: v.email || undefined, addressLine: v.addressLine || undefined, city: v.city || undefined } }),
      vehicle: { registrationNumber: v.registrationNumber, vehicleModelId: v.vehicleModelId || undefined, modelName: (v.modelName as string) || (model ? `${model.name} ${model.variant}`.trim() : ""), vin: v.vin || undefined },
      serviceType: v.serviceType,
      isEmergency: !!v.isEmergency,
      odometerIn: Number(v.odometerIn),
      fuelLevel: v.fuelLevel,
      reportedProblems: v.reportedProblems,
      vehicleCondition: v.vehicleCondition || undefined,
      existingDamage: v.existingDamage || undefined,
      accessoriesReceived: String(v.accessories || "").split(",").map((s) => s.trim()).filter(Boolean),
      expectedCompletionAt: v.expectedCompletionAt ? new Date(String(v.expectedCompletionAt)).toISOString() : undefined,
      serviceAdvisorId: v.serviceAdvisorId || undefined,
    };
    try {
      const job = await apiFetch<{ id: string; jobNumber: string }>("/api/service/jobs", { body });
      toast({ tone: "ok", text: `Job card ${job.jobNumber} created.` });
      router.push(`/service/${job.id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        Object.entries(e.fieldErrors).forEach(([k, m]) => m?.[0] && setError(k, { message: m[0] }));
        setErr(e.message);
      } else setErr("Network error.");
    }
  });

  return (
    <form onSubmit={submit} className="grid gap-6 xl:grid-cols-[1fr_1.4fr]" noValidate>
      <div className="space-y-6">
        <Card>
          <CardHeader title="1 · Customer" description="Search by the customer's mobile number." />
          <CardBody className="space-y-4">
            <div className="flex gap-2">
              <Input value={phone} onChange={(e) => { setPhone(e.target.value); setFound(undefined); }} placeholder="+91 98xxxxxxxx" inputMode="tel" aria-label="Customer phone" />
              <Button type="button" variant="outline" onClick={lookup} loading={looking} disabled={phone.replace(/\D/g, "").length < 10}>Find</Button>
            </div>
            {found && (
              <Notice tone="ok" title="Existing customer">
                <span className="inline-flex items-center gap-1">{found.fullName}</span>
                {found.vehicles.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {found.vehicles.map((v) => <button key={v.registrationNumber} type="button" onClick={() => pickVehicle(v.registrationNumber)} className="rounded-[3px] border border-emerald-300 bg-white px-2 py-1 text-xs text-ink hover:bg-ok-50">{v.registrationNumber} · {v.modelName}</button>)}
                  </div>
                )}
              </Notice>
            )}
            {found === null && (
              <div className="grid gap-3 sm:grid-cols-2">
                <p className="text-xs text-muted sm:col-span-2">No customer with this number — enter details to register them.</p>
                <Field label="Full name" required error={formState.errors.fullName?.message as string}><Input {...register("fullName", { required: "Name is required." })} /></Field>
                <Field label="Email" hint="Needed for portal access & email updates"><Input type="email" {...register("email")} /></Field>
                <Field label="Address"><Input {...register("addressLine")} /></Field>
                <Field label="City"><Input {...register("city")} /></Field>
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="2 · Vehicle" />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <Field label="Registration number" required error={formState.errors.registrationNumber?.message as string}><Input {...register("registrationNumber", { required: "Registration is required." })} placeholder="TN37AB1234" className="uppercase" /></Field>
            <Field label="Model">
              <Select {...register("vehicleModelId")}>
                <option value="">Other / not listed</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.name} {m.variant}</option>)}
              </Select>
            </Field>
            <Field label="Model name (as on RC)" hint="Leave blank to use the selected model"><Input {...register("modelName")} /></Field>
            <Field label="Chassis / VIN" hint="Optional for periodic service"><Input {...register("vin")} className="uppercase" /></Field>
          </CardBody>
        </Card>
      </div>
      <div className="space-y-6">
        <Card>
          <CardHeader title="3 · Reception details" />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <Field label="Service type" required>
              <Select {...register("serviceType")}>
                {["PERIODIC_SERVICE", "FREE_SERVICE", "GENERAL_REPAIR", "ACCIDENT_REPAIR", "WARRANTY_REPAIR", "BREAKDOWN", "INSPECTION_ONLY"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}
              </Select>
            </Field>
            <Field label="Service advisor">
              <Select {...register("serviceAdvisorId")}>{advisors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
            </Field>
            <Field label="Odometer (km)" required error={formState.errors.odometerIn?.message as string}><Input type="number" min={0} {...register("odometerIn", { required: "Odometer is required." })} /></Field>
            <Field label="Fuel level" required>
              <Select {...register("fuelLevel")}>{["EMPTY", "QUARTER", "HALF", "THREE_QUARTER", "FULL"].map((f) => <option key={f} value={f}>{f.replace("_", " ").toLowerCase()}</option>)}</Select>
            </Field>
            <Field label="Reported problems" required className="sm:col-span-2" error={formState.errors.reportedProblems?.message as string}><Textarea {...register("reportedProblems", { required: "Describe the customer's complaint." })} /></Field>
            <Field label="Vehicle condition"><Textarea {...register("vehicleCondition")} /></Field>
            <Field label="Existing damage"><Textarea {...register("existingDamage")} /></Field>
            <Field label="Accessories received" hint="Comma separated, e.g. Helmet, Phone mount"><Input {...register("accessories")} /></Field>
            <Field label="Initial expected completion" hint="Optional — shown as the intake estimate until inspection"><Input type="datetime-local" {...register("expectedCompletionAt")} /></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-4 accent-brand-600" {...register("isEmergency")} /> Emergency / breakdown (safety-critical work may start before estimate approval)</label>
          </CardBody>
        </Card>
        {err && <Notice tone="bad">{err}</Notice>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" size="lg" loading={formState.isSubmitting} disabled={found === undefined}>{found === undefined ? "Find the customer first" : "Create job card"}</Button>
        </div>
      </div>
    </form>
  );
}
