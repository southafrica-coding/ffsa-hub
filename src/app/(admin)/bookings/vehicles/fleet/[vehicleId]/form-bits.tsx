// Form pieces for the vehicle page's dialogs: 44px+ fields, mono labels, hint lines.

import { cn } from "@/lib/utils/cn";

export const field =
  "min-h-11 w-full min-w-0 border border-rule-strong bg-white px-3 py-2 text-[15px] focus:border-ink focus:outline-none disabled:bg-bone";

export function F({
  label,
  hint,
  wide,
  hidden,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  wide?: boolean;
  hidden?: boolean;
  children: React.ReactNode;
}) {
  if (hidden) return null;
  return (
    <label className={cn("grid min-w-0 content-start gap-1.5", wide && "sm:col-span-2")}>
      <span className="mono-label">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-[#55524A]">{hint}</span>}
    </label>
  );
}

export function Fieldset({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3 border-t border-ink pt-3">
      <legend className="pr-2 font-display text-[15px] font-black uppercase tracking-[0.04em]">{legend}</legend>
      {children}
    </fieldset>
  );
}

export const grid2 = "grid grid-cols-1 gap-4 sm:grid-cols-2";
