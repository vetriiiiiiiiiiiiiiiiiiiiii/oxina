"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, type ButtonProps } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/client";

/** One-click server action with optional confirmation; refreshes server data on success. */
export function ActionButton({ url, body, method = "POST", confirm, success = "Done.", children, onDone, ...props }: ButtonProps & {
  url: string;
  body?: unknown;
  method?: string;
  confirm?: string;
  success?: string | ((data: unknown) => string);
  onDone?: (data: unknown) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      {...props}
      loading={busy}
      onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setBusy(true);
        try {
          const data = await apiFetch(url, { method, body: body ?? {} });
          toast({ tone: "ok", text: typeof success === "function" ? success(data) : success });
          onDone?.(data);
          router.refresh();
        } catch (e) {
          toast({ tone: "bad", text: e instanceof ApiError ? e.message : "Network error." });
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </Button>
  );
}
