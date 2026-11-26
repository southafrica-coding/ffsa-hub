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

export function CoverImage({ src, title, className }: { src: string | null; title: string; className?: string }) {
  return (
    <div className={cn("relative aspect-[3/4] overflow-hidden bg-bone-2", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]" />
      ) : (
        <div className="flex h-full w-full flex-col justify-end bg-ink p-4">
          <span className="font-display text-[clamp(22px,5vw,34px)] font-black uppercase leading-[0.9] text-white">{title}</span>
          <span className="mt-3 h-[3px] w-8 bg-yellow" />
        </div>
      )}
    </div>
  );
}
