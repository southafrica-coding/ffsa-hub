// Server-side authoritative compute of a ticket type's display
// price from its target net and pricing mode. Wraps pricing.ts
// (pure math) with the DB read for active fee profiles.
//
// Use in admin save handlers (POST/PATCH ticket-types). The
// client may render a live gross-up preview, but the server
// always recomputes from staff input before persisting.
//
// See FFSA_Hub_Events_Ticketing_Spec.md §4.

import { grossUpToCover, type FeeProfile } from "./pricing";
import { DEFAULT_EVENT_CURRENCY } from "@/lib/currencies";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export async function computeDisplayPriceCents(
  supabase: Client,
  pricingMode: "fixed" | "pwyw",
  targetNetCents: number,
  // The parent event's currency. Fee rates differ per currency — a
  // fixed R3.00 component is not a fixed $3.00 one — so the gross-up
  // must only see profiles priced in the currency being sold in.
  currency: string = DEFAULT_EVENT_CURRENCY
): Promise<{ displayPriceCents?: number; error?: string }> {
  if (!Number.isInteger(targetNetCents) || targetNetCents < 0) {
    return { error: "target_net_cents must be a non-negative integer" };
  }
  if (targetNetCents === 0) return { displayPriceCents: 0 };
  if (pricingMode === "pwyw") return { displayPriceCents: targetNetCents };

  const { data, error } = await supabase
    .from("payment_fee_profiles")
    .select("provider, percent_bps, fixed_cents")
    .eq("is_active", true)
    .eq("currency", currency);

  if (error) {
    return { error: `Failed to read fee profiles: ${error.message}` };
  }
  if (!data || data.length === 0) {
    return {
      error: `No active payment fee profiles configured for ${currency}.`,
    };
  }

  // DB rows are snake_case; FeeProfile / grossUpToCover use camelCase.
  // Without this mapping the gross-up math reads undefined and returns NaN.
  const profiles: FeeProfile[] = data.map(
    (row: { provider: string; percent_bps: number; fixed_cents: number }) => ({
      provider: row.provider,
      percentBps: row.percent_bps,
      fixedCents: row.fixed_cents,
    })
  );

  return { displayPriceCents: grossUpToCover(targetNetCents, profiles) };
}
