// Small Store-only building blocks, in the Hub's flat language.
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("masthead-context", className)}>{children}</div>;
}

export function PrimaryButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex min-h-12 w-full items-center justify-center gap-2 border border-ink bg-ink px-5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-white transition-colors hover:bg-[var(--ink-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    >
      {children}
    </button>
  );
}

export function SecondaryLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-12 items-center justify-center gap-2 border border-ink bg-white px-5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-ink transition-colors hover:bg-bone",
        className
      )}
    >
      {children}
    </Link>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mono-label mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block font-sans text-[12px] normal-case tracking-normal text-[color:var(--text-tertiary)]">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "block h-12 w-full border border-rule-strong bg-white px-3.5 text-[15px] text-ink outline-none transition-colors placeholder:text-[color:var(--text-quiet)] focus:border-ink";

export function Notice({ tone = "quiet", children }: { tone?: "quiet" | "good" | "bad"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "bad" ? "alert" : "status"}
      className={cn(
        "border-l-2 bg-bone px-4 py-3 text-[13px] leading-relaxed text-[color:var(--text-secondary)]",
        tone === "bad" ? "border-destructive" : tone === "good" ? "border-grass" : "border-ink"
      )}
    >
      {children}
    </p>
  );
}

// The cover moved to ./cover-image (a client component: it falls back to
// the title box if the image fails).
export { CoverImage } from "./cover-image";
