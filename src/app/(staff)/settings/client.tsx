"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Notice } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/client";

export function SettingEditor({ branchId, settingKey, value }: { branchId: string; settingKey: string; value: number | boolean | string | { min: number; max: number } }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = React.useState(typeof value === "object" ? JSON.stringify(value) : String(value));
  const save = async () => {
    let parsed: unknown = v;
    if (typeof value === "number") parsed = Number(v);
    if (typeof value === "boolean") parsed = v === "true";
    if (typeof value === "object") try { parsed = JSON.parse(v); } catch { return toast({ tone: "bad", text: "Use JSON like {\"min\":30,\"max\":240}" }); }
    try {
      await apiFetch(`/api/settings/branch/${branchId}`, { method: "PUT", body: { key: settingKey, value: parsed } });
      toast({ tone: "ok", text: "Setting saved." });
      router.refresh();
    } catch (e) {
      toast({ tone: "bad", text: e instanceof ApiError ? e.message : "Failed." });
    }
  };
  return (
    <div className="flex items-center gap-2">
      {typeof value === "boolean" ? (
        <select value={v} onChange={(e) => setV(e.target.value)} className="h-8 rounded-[3px] border border-line px-2 text-sm"><option value="true">Yes</option><option value="false">No</option></select>
      ) : <Input value={v} onChange={(e) => setV(e.target.value)} className="h-8 w-48" />}
      <Button size="sm" variant="outline" onClick={save}>Save</Button>
    </div>
  );
}

export function ResetLink({ userId }: { userId: string }) {
  const [url, setUrl] = React.useState<string | null>(null);
  return url ? <Notice tone="ok"><span className="break-all text-xs">{url}</span></Notice> : (
    <Button size="sm" variant="ghost" onClick={async () => { if (!confirm("Issue a one-time password reset link (valid 24 h)?")) return; const r = await apiFetch<{ resetUrl: string }>(`/api/admin/users/${userId}/reset-password`, { body: {} }); setUrl(r.resetUrl); }}>Reset link</Button>
  );
}
