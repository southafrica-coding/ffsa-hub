// Storefront building blocks shared by home, category and item pages.
// Server components: the date bar is a plain GET form, so it works before
// any JavaScript arrives.

import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { dayLabel } from "@/lib/equipment/dates";
import { randsShort } from "@/lib/equipment/money";
import { itemTitle, withDates, type StoreItem } from "@/lib/equipment/storefront";

type Range = { from: string; to: string };

export function DateBar({
  action,
  range,
  today,
  hidden,
  submitLabel = "Show what's free",
  periodText,
  className,
}: {
  action: string;
  range: Range;
  today: string;
  hidden?: Record<string, string | undefined>;
  submitLabel?: string;
  periodText?: string;
  className?: string;
}) {
  const cell = "flex min-w-0 flex-col bg-[color:var(--hire-surface2)] px-3.5 py-2.5 md:px-4";
  return (
    <form
      action={action}
      className={cn(
        "grid grid-cols-2 gap-[2px] overflow-hidden rounded-lg border border-[color:var(--hire-line-strong)] bg-[color:var(--hire-line2)] md:flex",
        className
      )}
    >
      {Object.entries(hidden ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label className={cell}>
        <span className="hire-label">Collect</span>
        <input
          type="date"
          name="from"
          min={today}
          defaultValue={range.from}
          required
          aria-label="Collect on"
          className="hire-bare min-h-[28px] text-[16px] font-medium [color-scheme:dark]"
        />
      </label>
      <label className={cell}>
        <span className="hire-label">Return</span>
        <input
          type="date"
          name="to"
          min={today}
          defaultValue={range.to}
          required
          aria-label="Return on"
          className="hire-bare min-h-[28px] text-[16px] font-medium [color-scheme:dark]"
        />
      </label>
      {periodText && (
        <div className={cn(cell, "hidden md:flex")}>
          <span className="hire-label">Rate</span>
          <span className="text-[15px] font-medium capitalize text-[color:var(--hire-accent)]">{periodText}</span>
        </div>
      )}
      <button
        type="submit"
        className="col-span-2 flex min-h-[50px] items-center justify-center bg-[color:var(--hire-accent)] px-6 text-[15px] font-bold text-[color:var(--hire-on-accent)]"
      >
        {submitLabel}
      </button>
    </form>
  );
}

/** "2 free" / "2 of 4 free" / "Booked" — and its colour. */
export function freeText(i: Pick<StoreItem, "free" | "stock">): { text: string; tone: "ok" | "some" | "none" } {
  if (i.free <= 0) return { text: "Booked", tone: "none" };
  if (i.free >= i.stock) return { text: `${i.free} free`, tone: "ok" };
  return { text: `${i.free} of ${i.stock} free`, tone: "some" };
}

const toneClass = {
  ok: "text-[color:var(--hire-ok)]",
  some: "text-[color:var(--hire-accent)]",
  none: "text-[color:var(--hire-ink)]",
};

export function Photo({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden bg-[color:var(--hire-surface2)]", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-[0.14em] text-[color:var(--hire-dim)]">
          No photo yet
        </span>
      )}
    </div>
  );
}

/**
 * One product: a card in a grid on desktop (46a), a two-column row on a
 * phone (47a-2). Booked items are dimmed and say when they're free again.
 */
export function ItemCard({ item, range, label }: { item: StoreItem; range: Range; label?: string }) {
  const f = freeText(item);
  const booked = f.tone === "none";
  const href = withDates(`/hire/p/${item.slug}`, range);
  const title = itemTitle(item);
  return (
    <Link
      href={href}
      className={cn(
        "grid grid-cols-[92px_minmax(0,1fr)] items-center gap-3.5 border-b border-[color:var(--hire-line)] px-[18px] py-3.5 md:flex md:flex-col md:items-stretch md:gap-2.5 md:border-0 md:p-0",
        booked && "opacity-55"
      )}
    >
      <div className="relative">
        <Photo src={item.photo} alt={title} className="h-[92px] rounded-md md:h-[220px] md:rounded-lg" />
        {f.tone === "some" && (
          <span className="absolute left-3 top-3 hidden rounded bg-[color:var(--hire-accent)] px-2 py-1 text-[12px] font-bold text-[color:var(--hire-on-accent)] md:block">
            {item.free} of {item.stock} left
          </span>
        )}
        {booked && (
          <span className="absolute left-3 top-3 hidden rounded border border-[color:var(--hire-dim)] bg-[color:var(--hire-bg)] px-2 py-1 text-[12px] font-bold text-[color:var(--hire-ink)] md:block">
            Booked on your dates
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1 md:gap-2">
        {label && <span className="hidden text-[12px] uppercase tracking-[0.14em] text-[color:var(--hire-muted)] md:block">{label}</span>}
        <span className="text-[15px] font-medium text-[color:var(--hire-ink)] md:text-[16px]">{title}</span>
        <span className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between">
          <span className={cn("hire-display text-[24px] md:text-[30px]", booked ? "!text-[color:var(--hire-body)]" : "!text-[color:var(--hire-accent)]")}>
            {randsShort(item.priceCents)}{" "}
            <span className="font-sans text-[12px] text-[color:var(--hire-muted)] md:text-[13px]">{item.periodText}</span>
          </span>
          <span className={cn("text-[13px]", toneClass[f.tone], booked && "underline")}>
            {booked ? (item.freeFrom ? `Booked · free from ${dayLabel(item.freeFrom)}` : "Booked on your dates") : f.text}
          </span>
        </span>
      </div>
    </Link>
  );
}

export function ItemCardSkeleton() {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-3.5 border-b border-[color:var(--hire-line)] px-[18px] py-3.5 md:flex md:flex-col md:items-stretch md:gap-2.5 md:border-0 md:p-0">
      <div className="h-[92px] animate-pulse rounded-md bg-[color:var(--hire-surface2)] md:h-[220px] md:rounded-lg" />
      <div className="flex flex-col gap-2">
        <span className="h-[13px] w-4/5 animate-pulse rounded bg-[#231F19]" />
        <span className="h-5 w-2/5 animate-pulse rounded bg-[#231F19]" />
        <span className="h-[11px] w-1/3 animate-pulse rounded bg-[#1F1B16]" />
      </div>
    </div>
  );
}
