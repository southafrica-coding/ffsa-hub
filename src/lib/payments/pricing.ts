// FFSA Hub — Fee-inclusive ("gross-up") ticket pricing.
//
// Staff set the target net (what FFSA keeps); buyers pay a
// grossed-up display price that already covers the processor
// fee, so there is never a separate fee line at checkout.
// All amounts are integer minor units ("cents") of the event's
// currency — see events.currency and EVENT_CURRENCIES. Only
// two-decimal currencies are offered, so the math below is
// currency-agnostic; what differs per currency is the fee profile
// it is handed (a fixed R3.00 is not a fixed $3.00).
//
// Gross-up applies to fixed-price tiers only — pay-what-you-want
// amounts and the donation add-on are charged exactly as
// entered. See FFSA_Hub_Events_Ticketing_Spec.md §4.

/**
 * A payment processor's fee structure for ONE currency. percentBps is
 * basis points (290 = 2.90%); fixedCents is in that currency's minor units.
 */
export type FeeProfile = {
  provider: string;
  percentBps: number;
  fixedCents: number;
};

/**
 * Gross up a target net amount so that, after `profile`'s fee is
 * taken from the charge, FFSA still keeps at least `targetNetCents`:
 *
 *   display = ceil( (net + fixed) / (1 - percent) )
 *
 * A zero (free) target stays free. Throws on a nonsensical fee
 * profile (negative, or 100% or more).
 */
export function grossUpCents(targetNetCents: number, profile: FeeProfile): number {
  if (targetNetCents <= 0) return 0;
  if (profile.percentBps < 0 || profile.percentBps >= 10000) {
    throw new Error(
      `Invalid fee profile "${profile.provider}": percentBps must be in [0, 10000), got ${profile.percentBps}`,
    );
  }
  const rate = profile.percentBps / 10000;
  return Math.ceil((targetNetCents + profile.fixedCents) / (1 - rate));
}

/**
 * Gross up so that ONE displayed price covers whichever provider
 * the buyer ends up choosing. Returns the highest gross-up across
 * every active profile — FFSA is never short, and a buyer who pays
 * via the cheaper provider simply nets FFSA a little extra. Throws
 * if there are no profiles to price against.
 */
export function grossUpToCover(targetNetCents: number, profiles: FeeProfile[]): number {
  if (targetNetCents <= 0) return 0;
  if (profiles.length === 0) {
    throw new Error("No active payment fee profiles — cannot price a ticket.");
  }
  return Math.max(...profiles.map((p) => grossUpCents(targetNetCents, p)));
}

/**
 * The fee a provider actually takes on a gross (charged) amount.
 * For reconciliation and reporting — not used to price tickets.
 */
export function providerFeeCents(grossCents: number, profile: FeeProfile): number {
  if (grossCents <= 0) return 0;
  return Math.round((grossCents * profile.percentBps) / 10000 + profile.fixedCents);
}
