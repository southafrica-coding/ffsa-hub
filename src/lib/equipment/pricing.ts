// What a hire costs (spec rules 9, 10, 12). Pure: no database, no clock.
//
//   Fri → Mon is one weekend. 5 to 7 days is a week. Anything else is
//   day rate × days. Each line takes the cheapest period that covers the
//   dates — a week price can beat four day prices, so a 4-day hire may be
//   charged as a week. Missing weekend/week prices simply aren't options.
//   Internal (ministry) orders pay internal_day_cents × days and no deposit.
//
// Money is integer ZAR cents, excl. VAT. The damage waiver is a share of the
// hire; VAT is charged on hire + waiver (checkout frame 46d). Internal orders
// carry no waiver: damage is billed to the wing.

import { dayCount, weekday } from "./dates";

export type RatePeriod = "day" | "weekend" | "week";
export type OrderKind = "external" | "internal";

export type QuoteProduct = {
  id: string;
  price_day_cents: number | null;
  price_weekend_cents: number | null;
  price_week_cents: number | null;
  deposit_cents: number;
  internal_day_cents: number;
};

export type QuoteLineInput = { product: QuoteProduct; quantity: number };

export type QuoteSettings = { vat_bps: number; waiver_bps: number };

export type QuoteLine = {
  productId: string;
  quantity: number;
  /** The period this line was priced on (the cheapest that covers the dates). */
  period: RatePeriod;
  /** Per unit, for the whole hire. */
  unitPriceCents: number;
  lineTotalCents: number;
  /** Per unit. */
  depositCents: number;
  depositTotalCents: number;
  /** False when the product has no price for this kind of order. */
  priced: boolean;
};

export type Quote = {
  days: number;
  /** What the dates are: weekend if they sit inside one Fri–Mon, week for 5–7 days, else day. */
  period: RatePeriod;
  lines: QuoteLine[];
  subtotalCents: number;
  waiverCents: number;
  vatCents: number;
  totalCents: number;
  depositCents: number;
};

/** True when [from, to] sits inside a single Friday → Monday. */
export function isWeekend(from: string, to: string): boolean {
  const back = { 5: 0, 6: 1, 0: 2, 1: 3 }[weekday(from)];
  if (back === undefined) return false;
  return dayCount(from, to) <= 4 - back;
}

export function periodForDates(from: string, to: string): RatePeriod {
  const days = dayCount(from, to);
  if (isWeekend(from, to)) return "weekend";
  if (days >= 5 && days <= 7) return "week";
  return "day";
}

const pct = (cents: number, bps: number) => Math.round((cents * bps) / 10_000);

/** Cheapest price per unit for an external hire of `days` days, and the period it used. */
export function unitPrice(
  p: QuoteProduct,
  days: number,
  weekendOk: boolean
): { cents: number; period: RatePeriod } | null {
  const options: { cents: number; period: RatePeriod }[] = [];
  if (p.price_day_cents != null) options.push({ cents: p.price_day_cents * days, period: "day" });
  if (weekendOk && p.price_weekend_cents != null) options.push({ cents: p.price_weekend_cents, period: "weekend" });
  if (p.price_week_cents != null) {
    const weeks = Math.ceil(days / 7);
    options.push({ cents: p.price_week_cents * weeks, period: "week" });
    // Past a week: whole weeks plus the odd days at the day rate.
    const whole = Math.floor(days / 7);
    const rest = days % 7;
    if (whole > 0 && rest > 0 && p.price_day_cents != null) {
      options.push({ cents: p.price_week_cents * whole + p.price_day_cents * rest, period: "week" });
    }
  }
  if (options.length === 0) return null;
  return options.reduce((best, o) => (o.cents < best.cents ? o : best));
}

export function quote(
  lines: QuoteLineInput[],
  from: string,
  to: string,
  kind: OrderKind,
  settings: QuoteSettings
): Quote {
  const days = dayCount(from, to);
  const weekendOk = isWeekend(from, to);

  const priced: QuoteLine[] = lines.map(({ product: p, quantity }) => {
    const qty = Math.max(0, Math.floor(quantity));
    if (kind === "internal") {
      const unit = p.internal_day_cents * days;
      return {
        productId: p.id,
        quantity: qty,
        period: "day",
        unitPriceCents: unit,
        lineTotalCents: unit * qty,
        depositCents: 0,
        depositTotalCents: 0,
        priced: true,
      };
    }
    const best = unitPrice(p, days, weekendOk);
    const unit = best?.cents ?? 0;
    return {
      productId: p.id,
      quantity: qty,
      period: best?.period ?? "day",
      unitPriceCents: unit,
      lineTotalCents: unit * qty,
      depositCents: p.deposit_cents,
      depositTotalCents: p.deposit_cents * qty,
      priced: best != null,
    };
  });

  const subtotalCents = priced.reduce((s, l) => s + l.lineTotalCents, 0);
  const waiverCents = kind === "internal" ? 0 : pct(subtotalCents, settings.waiver_bps);
  const vatCents = pct(subtotalCents + waiverCents, settings.vat_bps);

  return {
    days,
    period: periodForDates(from, to),
    lines: priced,
    subtotalCents,
    waiverCents,
    vatCents,
    totalCents: subtotalCents + waiverCents + vatCents,
    depositCents: priced.reduce((s, l) => s + l.depositTotalCents, 0),
  };
}

/** "weekend", "week", "3 days", "day" — how a card names the period it priced. */
export function periodLabel(period: RatePeriod, days: number): string {
  if (period === "weekend") return "weekend";
  if (period === "week") return days > 7 ? `${days} days` : "week";
  return days === 1 ? "day" : `${days} days`;
}
