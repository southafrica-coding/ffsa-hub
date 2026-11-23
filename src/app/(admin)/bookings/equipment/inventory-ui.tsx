// Form pieces shared by the inventory screens (stage O): the same inputs,
// labels and buttons as the unit edit form, so the hire module reads as one.

import { cn } from "@/lib/utils/cn";

export const BOX =
  "w-full rounded-[8px] border border-[color:var(--hire-line-strong)] bg-transparent px-3.5 text-[16px] text-[color:var(--hire-ink)] md:text-[15px]";

export const PRIMARY =
  "flex h-11 min-w-[96px] items-center justify-center rounded-[8px] bg-[color:var(--hire-accent)] px-5 text-[14px] font-bold text-[color:var(--hire-on-accent)] disabled:opacity-60";

export const SECONDARY =
  "flex h-11 items-center justify-center rounded-[8px] border border-[color:var(--hire-line-strong)] px-5 text-[14px] text-[color:var(--hire-ink)] hover:bg-[color:var(--hire-hover)]";

export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="hire-label mb-1.5 block">
        {label}
        {hint && <span className="ml-2 normal-case tracking-normal text-[color:var(--hire-dim)]">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** Big toggle choice (tracking kind, school vs ministry). 44px+ targets. */
export function Choice({
  selected,
  onClick,
  title,
  help,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  help?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex min-h-[52px] w-full flex-col items-start justify-center rounded-[8px] border px-3.5 py-2.5 text-left",
        selected
          ? "border-[color:var(--hire-accent)] bg-[color:var(--hire-surface2)]"
          : "border-[color:var(--hire-line-strong)] hover:bg-[color:var(--hire-hover)]"
      )}
    >
      <span className={cn("text-[15px] font-bold", selected ? "text-[color:var(--hire-accent)]" : "text-[color:var(--hire-ink)]")}>
        {title}
      </span>
      {help && <span className="mt-0.5 text-[12px] leading-snug text-[color:var(--hire-muted)]">{help}</span>}
    </button>
  );
}
