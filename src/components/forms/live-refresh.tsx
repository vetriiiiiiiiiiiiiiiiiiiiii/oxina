"use client";
import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Subscribes to a job's SSE stream and refreshes server data when it changes.
 * Falls back to polling every 20 s if EventSource fails or is unavailable.
 */
export function LiveRefresh({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"live" | "polling" | "connecting">("connecting");
  React.useEffect(() => {
    let poll: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      setMode("polling");
      if (!poll) poll = setInterval(() => router.refresh(), 20_000);
    };
    if (typeof EventSource === "undefined") {
      startPolling();
      return () => { if (poll) clearInterval(poll); };
    }
    const es = new EventSource(`/api/service/jobs/${jobId}/stream`);
    let errors = 0;
    es.addEventListener("ready", () => {
      errors = 0;
      setMode("live");
      if (poll) { clearInterval(poll); poll = null; }
    });
    es.addEventListener("update", () => router.refresh());
    es.onerror = () => {
      errors++;
      if (errors >= 3) { es.close(); startPolling(); }
    };
    return () => {
      es.close();
      if (poll) clearInterval(poll);
    };
  }, [jobId, router]);
  return (
    <span className="text-[12px] text-muted" title={mode === "live" ? "This page updates as soon as anything changes" : "This page refreshes every 20 seconds"}>
      {mode === "live" ? "Updating live" : mode === "polling" ? "Refreshing every 20 s" : "Connecting…"}
    </span>
  );
}
