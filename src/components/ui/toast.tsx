"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

type Toast = { id: number; tone: "ok" | "bad"; text: string };
const Ctx = React.createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => React.useContext(Ctx);

/** Plain status messages in the bottom-left corner. Errors stay longer than confirmations. */
export function Toaster({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);
  const push = React.useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { ...t, id }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.tone === "bad" ? 8000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-3 left-3 z-[100] flex w-[min(94vw,360px)] flex-col gap-1.5" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cn("pointer-events-auto flex items-start justify-between gap-3 border border-l-[3px] bg-white px-3 py-2 text-[13px] text-ink", t.tone === "ok" ? "border-line border-l-ok-600" : "border-line border-l-bad-600")}>
            <p>{t.text}</p>
            <button onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))} className="text-muted hover:text-ink" aria-label="Dismiss">×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
