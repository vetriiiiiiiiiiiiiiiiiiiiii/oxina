"use client";
import * as React from "react";
import { Button, Notice } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/client";

export function PortalAccess({ customerId, hasAccount }: { customerId: string; hasAccount: boolean }) {
  const toast = useToast();
  const [link, setLink] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant="outline" loading={busy} onClick={async () => {
        setBusy(true);
        try {
          const r = await apiFetch<{ setupUrl: string }>(`/api/customers/${customerId}/portal-access`, { body: {} });
          setLink(r.setupUrl);
        } catch (e) {
          toast({ tone: "bad", text: e instanceof ApiError ? e.message : "Failed." });
        } finally {
          setBusy(false);
        }
      }}>{hasAccount ? "Re-issue portal link" : "Create portal access"}</Button>
      {link && <Notice tone="ok" title="One-time setup link (valid 72 h)"><span className="break-all text-xs">{link}</span><br /><span className="text-xs">Share it with the customer securely. It is shown only once.</span></Notice>}
    </div>
  );
}

export function RevealButton({ documentId }: { documentId: string }) {
  const [v, setV] = React.useState<string | null>(null);
  return v ? <span className="font-mono text-xs">{v}</span> : (
    <Button size="sm" variant="ghost" onClick={async () => {
      if (!confirm("Reveal the full identifier? This access is audited.")) return;
      const r = await apiFetch<{ identifier: string | null }>(`/api/customers/documents/${documentId}/reveal`, { body: {} });
      setV(r.identifier ?? "—");
      setTimeout(() => setV(null), 30000);
    }}>Reveal</Button>
  );
}
