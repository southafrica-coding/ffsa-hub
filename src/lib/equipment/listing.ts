// When a product may go on the store (spec rule 1, as changed by migration
// 400). The database enforces
//   CHECK (NOT is_listed OR price_day_cents IS NOT NULL)
// and this says the same thing in plain words before anyone hits it.
// Gear that can't leave the building may still be listed: it shows as
// "Not for hire" and nobody can pick it.
// Warnings don't block: the product can go live, it just won't look right.

export type ListingFields = {
  can_leave_building: boolean;
  price_day_cents: number | null;
  price_weekend_cents: number | null;
  price_week_cents: number | null;
  store_category_id: string | null;
};

/** Reasons the product can't go live. Empty = it can. */
export function goLiveBlockers(p: ListingFields): string[] {
  const out: string[] = [];
  if (p.price_day_cents == null) {
    out.push("Set a day price. Without one there's nothing to charge.");
  }
  return out;
}

/** Things worth fixing that don't stop it going live. */
export function listingWarnings(
  p: ListingFields,
  extra: { photos: number; bookable: number }
): string[] {
  const out: string[] = [];
  if (!p.can_leave_building) {
    out.push("“Can leave the building” is off, so it will show as Not for hire: people can see it but not pick it.");
  }
  if (extra.photos === 0) out.push("No photos yet. People rarely hire what they can't see.");
  if (!p.store_category_id) out.push("No store category, so it only shows under “All gear”.");
  if (extra.bookable === 0) out.push("No units are bookable right now, so it will show as booked.");
  if (
    p.price_day_cents != null &&
    p.price_weekend_cents != null &&
    p.price_weekend_cents > p.price_day_cents * 4
  ) {
    out.push("The weekend price is more than four day prices, so nobody will be charged it.");
  }
  if (
    p.price_day_cents != null &&
    p.price_week_cents != null &&
    p.price_week_cents > p.price_day_cents * 7
  ) {
    out.push("The week price is more than seven day prices, so nobody will be charged it.");
  }
  return out;
}

/** "120" or "120.50" → cents. Blank → null. Anything else → NaN. */
export function parseRands(input: string): number | null {
  const s = input.replace(/[\sR,]/g, "").trim();
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return Number.NaN;
  return Math.round(Number(s) * 100);
}

/** Cents → "120" or "120.50" for an input box. */
export function centsToInput(cents: number | null): string {
  if (cents == null) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** "Type: Dynamic, cardioid" lines ⇄ the specs object. */
export function parseSpecs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

export function specsToText(specs: Record<string, string> | null | undefined): string {
  return Object.entries(specs ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

export function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}
