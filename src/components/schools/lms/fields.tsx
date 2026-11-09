import { cn } from "@/lib/utils/cn";

export const fieldClass =
  "w-full min-h-11 border border-ink bg-white px-3 py-2.5 text-[14px] text-ink placeholder:text-[#8A8678] focus:outline-none";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mono-label">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="mt-1.5 text-[12px] leading-snug text-[#55524A]">{hint}</p> : null}
    </label>
  );
}

export function Notice({ tone = "quiet", children }: { tone?: "quiet" | "warn"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "border px-4 py-3 text-[13px] leading-snug",
        tone === "warn" ? "border-amber-border bg-bone text-amber" : "border-ink bg-bone text-ink"
      )}
    >
      {children}
    </p>
  );
}

export function SquareButton({
  tone = "solid",
  type = "button",
  disabled,
  onClick,
  children,
}: {
  tone?: "solid" | "outline" | "quiet";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center justify-center border px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] disabled:opacity-50",
        tone === "solid" && "border-ink bg-ink text-white hover:bg-[#262622]",
        tone === "outline" && "border-ink bg-white text-ink hover:bg-bone",
        tone === "quiet" && "border-transparent bg-transparent text-[#55524A] hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}
