"use client";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Button, Field, Input, Notice } from "@/components/ui";
import { apiFetch, ApiError } from "@/lib/client";

type F = { name: string; label: string; type: string; autoComplete?: string; hint?: string };

export function AuthForm({ fields, url, submit, extra, onSuccess, hidden }: {
  fields: F[];
  url: string;
  submit: string;
  extra?: React.ReactNode;
  hidden?: Record<string, string>;
  onSuccess?: (data: { redirect?: string; message?: string }) => void;
}) {
  const { register, handleSubmit, formState, setError } = useForm<Record<string, string>>();
  const [error, setErr] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit(async (v) => {
        setErr(null);
        try {
          const data = await apiFetch<{ redirect?: string; message?: string }>(url, { body: { ...v, ...hidden } });
          if (data.message) setMessage(data.message);
          onSuccess?.(data);
          if (data.redirect) window.location.assign(data.redirect);
        } catch (e) {
          if (e instanceof ApiError) {
            Object.entries(e.fieldErrors).forEach(([k, m]) => m?.[0] && setError(k, { message: m[0] }));
            setErr(e.message);
          } else setErr("Network error. Please try again.");
        }
      })}
    >
      {error && <Notice tone="bad">{error}</Notice>}
      {message && <Notice tone="ok">{message}</Notice>}
      {fields.map((f) => (
        <Field key={f.name} label={f.label} hint={f.hint} error={formState.errors[f.name]?.message}>
          <Input type={f.type} autoComplete={f.autoComplete} aria-invalid={!!formState.errors[f.name]} className="h-9" {...register(f.name, { required: `${f.label} is required.` })} />
        </Field>
      ))}
      {extra}
      <Button type="submit" className="h-9 w-full" loading={formState.isSubmitting}>{submit}</Button>
    </form>
  );
}
