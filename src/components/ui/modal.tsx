"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./index";

const CloseCtx = React.createContext<(() => void) | null>(null);
/** Forms inside a Modal call this after a successful save to close it. */
export const useModalClose = () => React.useContext(CloseCtx);

/**
 * Native <dialog>: the browser handles focus trapping, Esc and the backdrop.
 * Children can be plain nodes (usable from Server Components) or a render function (client only).
 */
export function Modal({ trigger, title, description, children, wide, triggerProps }: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  wide?: boolean;
  triggerProps?: ButtonProps;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => {
    ref.current?.close();
    setOpen(false);
  }, []);
  return (
    <>
      <Button type="button" size="sm" variant="outline" {...triggerProps} onClick={() => { setOpen(true); ref.current?.showModal(); }}>
        {trigger}
      </Button>
      <dialog ref={ref} onClose={() => setOpen(false)} className={cn("m-auto w-[min(94vw,520px)] rounded-[4px] border border-line-strong bg-white p-0 text-ink", wide && "w-[min(96vw,860px)]")}>
        <div className="flex items-baseline justify-between gap-4 border-b border-line bg-shade px-4 py-2.5">
          <div>
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {description && <p className="text-[13px] text-muted">{description}</p>}
          </div>
          <button type="button" onClick={close} className="text-[13px] text-muted hover:text-ink">Close</button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-4 py-4"><CloseCtx.Provider value={close}>{open && (typeof children === "function" ? children(close) : children)}</CloseCtx.Provider></div>
      </dialog>
    </>
  );
}
