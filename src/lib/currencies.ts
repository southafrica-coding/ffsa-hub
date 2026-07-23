export const BASE_CURRENCY = "ZAR";

export const SUPPORTED_CURRENCIES = [
  { code: "ZAR", name: "South African Rand", symbol: "R" },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh" },
  { code: "MZN", name: "Mozambican Metical", symbol: "MT" },
  { code: "BIF", name: "Burundian Franc", symbol: "FBu" },
  { code: "THB", name: "Thai Baht", symbol: "฿" },
  { code: "KHR", name: "Cambodian Riel", symbol: "៛" },
  { code: "PYG", name: "Paraguayan Guarani", symbol: "₲" },
  { code: "MGA", name: "Malagasy Ariary", symbol: "Ar" },
  { code: "UGX", name: "Ugandan Shilling", symbol: "USh" },
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "MWK", name: "Malawian Kwacha", symbol: "MK" },
  { code: "TZS", name: "Tanzanian Shilling", symbol: "TSh" },
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]["code"];

// ────────────────────────────────────────────────────────────
// Event ticketing currencies
// ────────────────────────────────────────────────────────────
// A deliberately smaller list than SUPPORTED_CURRENCIES above (which
// serves outreach finance and school fees). Ticketing stores money as
// integer minor units — "cents" — everywhere, so it can only offer
// two-decimal currencies. Several entries above (BIF, PYG, UGX) are
// zero-decimal at Stripe and would be charged 100x wrong.
//
// Adding a currency here also needs a payment_fee_profiles row for it
// (see migration 134) or gross-up pricing has no rates to work from.

export const EVENT_CURRENCIES = [
  { code: "ZAR", name: "South African Rand", symbol: "R", locale: "en-ZA" },
  { code: "USD", name: "US Dollar", symbol: "$", locale: "en-US" },
] as const;

export type EventCurrencyCode = (typeof EVENT_CURRENCIES)[number]["code"];

export const DEFAULT_EVENT_CURRENCY: EventCurrencyCode = "ZAR";

export function isEventCurrency(value: unknown): value is EventCurrencyCode {
  return EVENT_CURRENCIES.some((c) => c.code === value);
}

/** The currency entry for a code, falling back to ZAR for anything unknown. */
export function eventCurrency(code: string | null | undefined) {
  return (
    EVENT_CURRENCIES.find((c) => c.code === code) ?? EVENT_CURRENCIES[0]
  );
}

/** Just the symbol — for inline hints like "Target net (R)". */
export function currencySymbol(code: string | null | undefined): string {
  return eventCurrency(code).symbol;
}

/**
 * Render integer minor units as money in `currency`.
 *
 * Replaces the hand-rolled `R${cents / 100}` helpers that used to live
 * privately in each storefront, the admin orders tab, the ticket
 * emails and the Slack report. Digits follow the currency's own locale
 * and the symbol is prefixed tight against them, matching how the
 * brand storefronts already rendered rands: ZAR reads "R1 234,56" and
 * USD reads "$1,234.56".
 *
 * Note this is NOT Intl's `style: "currency"`, which would insert a
 * space after the symbol ("R 1 234,56") and change every existing
 * price on the site.
 */
export function formatMoney(
  cents: number,
  currency: string | null | undefined = DEFAULT_EVENT_CURRENCY
): string {
  const entry = eventCurrency(currency);
  const amount = cents / 100;
  const digits = new Intl.NumberFormat(entry.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${entry.symbol}${digits}`;
}

/**
 * Which payment providers can take money in a currency.
 *
 * PayFast is a South African ZAR-only processor — its API has no
 * currency field at all — so anything other than ZAR is Stripe-only.
 * The checkout route enforces this; the storefronts use it to decide
 * which pay buttons to render.
 */
export function providersForCurrency(
  currency: string | null | undefined
): ReadonlyArray<"payfast" | "stripe"> {
  return eventCurrency(currency).code === "ZAR"
    ? (["payfast", "stripe"] as const)
    : (["stripe"] as const);
}
