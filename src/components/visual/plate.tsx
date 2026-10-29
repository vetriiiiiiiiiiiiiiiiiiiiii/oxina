import { cn } from "@/lib/utils";

/** "TN37DX4521" → "TN 37 DX 4521"; leaves anything unusual as-is. */
export function formatReg(reg: string) {
  const m = reg.replace(/\s+/g, "").toUpperCase().match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(" ") : reg.toUpperCase();
}

/** Registration number drawn like an Indian number plate (white, black border, IND strip). */
export function RegPlate({ reg, size = "sm", className }: { reg: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const s = { sm: "text-[12px] h-[20px]", md: "text-[14px] h-[26px]", lg: "text-[18px] h-[34px]" }[size];
  return (
    <span className={cn("inline-flex shrink-0 items-stretch overflow-hidden rounded-[3px] border-[1.5px] border-ink bg-white align-middle font-mono font-semibold leading-none text-ink", s, className)} title={`Registration ${formatReg(reg)}`}>
      <span className="flex flex-col items-center justify-center bg-[#1d4fa8] px-[3px] text-[7px] font-sans font-bold tracking-tight text-white" aria-hidden>
        IND
      </span>
      <span className="flex items-center whitespace-nowrap px-1.5 tracking-[0.04em]">{formatReg(reg)}</span>
    </span>
  );
}
