"use client";
import * as React from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select, Textarea, Notice } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useModalClose } from "@/components/ui/modal";
import { apiFetch, ApiError } from "@/lib/client";
import { cn } from "@/lib/utils";

export type FieldDef = {
  name: string;
  label: string;
  /** Dotted names (e.g. "vehicle.vin") build nested objects. "multiselect" yields string[]; "list" splits comma-separated text. */
  type?: "text" | "email" | "number" | "date" | "datetime-local" | "password" | "select" | "textarea" | "checkbox" | "tel" | "multiselect" | "list";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  hint?: string;
  defaultValue?: string | number | boolean;
  min?: number;
  step?: string;
  span?: 1 | 2;
};

/**
 * Declarative form on React Hook Form. Client-side checks catch the obvious; the server's
 * Zod validation is authoritative and its field errors are mapped back onto inputs.
 */
export function SimpleForm({ fields, url, method = "POST", submitLabel = "Save", transform, onDone, successMessage = "Saved.", redirectTo, columns = 2, fixed, redirectPattern }: {
  fields: FieldDef[];
  /** Static values merged into the request body (serializable — usable from server components). */
  fixed?: Record<string, unknown>;
  /** e.g. "/service/{id}" — {key} is replaced from the response data. */
  redirectPattern?: string;
  url: string;
  method?: string;
  submitLabel?: string;
  transform?: (v: Record<string, unknown>) => unknown;
  onDone?: (data: unknown) => void;
  successMessage?: string | ((data: unknown) => string);
  redirectTo?: (data: unknown) => string | null;
  columns?: 1 | 2;
}) {
  const router = useRouter();
  const toast = useToast();
  const closeModal = useModalClose();
  const defaults = Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? (f.type === "checkbox" ? false : f.type === "multiselect" ? [] : "")]));
  const { register, handleSubmit, setError, formState } = useForm<Record<string, unknown>>({ defaultValues: defaults });
  const [formError, setFormError] = React.useState<string | null>(null);

  const submit = handleSubmit(async (raw) => {
    setFormError(null);
    const cleaned: Record<string, unknown> = { ...(fixed ?? {}) };
    const setPath = (k: string, val: unknown) => {
      const parts = k.split(".");
      let o = cleaned as Record<string, unknown>;
      parts.slice(0, -1).forEach((p) => (o = (o[p] ??= {}) as Record<string, unknown>));
      o[parts.at(-1)!] = val;
    };
    for (const f of fields) {
      const v = raw[f.name];
      if (v === "" || v === undefined || v === false && f.type !== "checkbox") continue;
      const val =
        f.type === "number" ? Number(v) :
        f.type === "datetime-local" ? new Date(String(v)).toISOString() :
        f.type === "list" ? String(v).split(",").map((x) => x.trim()).filter(Boolean) :
        f.type === "multiselect" ? (Array.isArray(v) ? v : v ? [v] : []) : v;
      setPath(f.name, val);
    }
    try {
      const data = await apiFetch(url, { method, body: transform ? transform(cleaned) : cleaned });
      toast({ tone: "ok", text: typeof successMessage === "function" ? successMessage(data) : successMessage });
      onDone?.(data);
      closeModal?.();
      const to = redirectTo?.(data) ?? (redirectPattern ? redirectPattern.replace(/\{(\w+)\}/g, (_, k) => String((data as Record<string, unknown>)[k] ?? "")) : null);
      if (to) router.push(to);
      else router.refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        let mapped = false;
        for (const [k, msgs] of Object.entries(e.fieldErrors)) {
          if (msgs?.length && fields.some((f) => f.name === k)) {
            setError(k, { message: msgs[0] });
            mapped = true;
          }
        }
        setFormError(mapped ? "Please correct the highlighted fields." : e.message);
      } else setFormError("Network error. Please try again.");
    }
  });

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {formError && <Notice tone="bad">{formError}</Notice>}
      <div className={cn("grid gap-4", columns === 2 && "sm:grid-cols-2")}>
        {fields.map((f) => {
          const err = formState.errors[f.name]?.message as string | undefined;
          const reg = register(f.name, { required: f.required ? `${f.label} is required.` : false });
          const common = { id: f.name, placeholder: f.placeholder, "aria-invalid": !!err };
          const span = f.span === 2 || f.type === "textarea" ? "sm:col-span-2" : "";
          if (f.type === "multiselect")
            return (
              <Field key={f.name} label={f.label} hint={f.hint} error={err} required={f.required} className="sm:col-span-2">
                <div className="grid max-h-48 gap-1.5 overflow-y-auto rounded-[3px] border border-line p-2 sm:grid-cols-2">
                  {f.options?.map((o) => (
                    <label key={o.value} className="flex items-center gap-2 text-sm"><input type="checkbox" value={o.value} className="size-4 accent-brand-600" {...register(f.name, { required: f.required ? `Choose at least one.` : false })} />{o.label}</label>
                  ))}
                </div>
              </Field>
            );
          if (f.type === "checkbox")
            return (
              <label key={f.name} className={cn("flex items-center gap-2 text-sm", span)}>
                <input type="checkbox" className="size-4 rounded border-line accent-brand-600" {...reg} />
                {f.label}
              </label>
            );
          return (
            <Field key={f.name} label={f.label} hint={f.hint} error={err} required={f.required} className={span}>
              {f.type === "select" ? (
                <Select {...common} {...reg}>
                  <option value="">Select…</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : f.type === "textarea" ? (
                <Textarea {...common} {...reg} />
              ) : (
                <Input {...common} type={f.type === "list" ? "text" : f.type ?? "text"} min={f.min} step={f.step} {...reg} />
              )}
            </Field>
          );
        })}
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={formState.isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
