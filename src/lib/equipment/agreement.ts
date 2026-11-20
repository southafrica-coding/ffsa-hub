// The rental agreement a customer accepts at checkout (frame 46d). Built
// from equipment_settings so the numbers in it always match what we charge;
// the version they accepted is stored on the order (agreement_version).
//
// The wording follows the spec's rules and the design's summary. It is a
// starting draft: have it read before the store takes real money.

import { rands } from "./money";

export type AgreementTerms = {
  waiver_bps: number;
  waiver_cover_cents: number;
  deposit_refund_days: number;
  agreement_version: string;
};

/** The short version shown open on the checkout page. */
export function agreementSummary(t: AgreementTerms): string[] {
  return [
    "The gear is checked with you at collection and again at return. Photos are taken both times and you sign on the staff member's phone.",
    "Late returns are charged at the day rate for each day late, from the deposit first.",
    "Damage or missing items come out of the deposit.",
    `The damage waiver covers accidental damage up to ${rands(t.waiver_cover_cents)} per order. It doesn't cover loss or theft.`,
    `Your deposit is refunded within ${t.deposit_refund_days} working days of the gear being checked back in.`,
  ];
}

/** The full text behind "Read the full agreement". */
export function agreementSections(t: AgreementTerms): { heading: string; body: string }[] {
  const waiverPct = (t.waiver_bps / 100).toLocaleString("en-ZA", { maximumFractionDigits: 2 });
  return [
    {
      heading: "1. Who this is between",
      body: "This agreement is between Fire & Fragrance South Africa (“we”) and the person named on the order (“you”). It covers the equipment listed on the order, for the dates on the order.",
    },
    {
      heading: "2. Collection and return",
      body: "You collect the equipment from the FFSA base at the time you chose, and return it there by the return time on the order. Bring the ID you gave at checkout; a staff member checks it before anything is handed over. We check each item with you and take photos at collection and at return, and you sign for it on the staff member's phone.",
    },
    {
      heading: "3. Looking after it",
      body: "Use the equipment for its normal purpose, keep it dry and secure, and don't lend it on or take it apart. If something goes wrong while you have it, tell us straight away using “Report an issue” on your rental page.",
    },
    {
      heading: "4. Late returns",
      body: "If equipment comes back after the return date, each late day is charged at that item's day rate. Late charges come out of your deposit first; anything beyond the deposit is invoiced to you.",
    },
    {
      heading: "5. Damage, loss and the waiver",
      body: `Every outside hire includes a damage waiver of ${waiverPct}% of the hire. It covers accidental damage up to ${rands(t.waiver_cover_cents)} per order. It does not cover loss, theft, or damage from misuse. Damage the waiver doesn't cover, and the replacement cost of anything lost or stolen, comes out of your deposit, and anything beyond the deposit is invoiced to you.`,
    },
    {
      heading: "6. Your deposit",
      body: `The deposit is held for the length of the hire. Once the equipment is back and checked, we refund it within ${t.deposit_refund_days} working days, less any late, damage or missing-item charges. We tell you about any deduction, and why, before we make it.`,
    },
    {
      heading: "7. Cancelling",
      body: "To cancel, reply to your confirmation email or contact the base office as early as you can. We refund the deposit in full on a cancelled order; refunds of the hire are at our discretion depending on how close to the date you cancel.",
    },
    {
      heading: "8. Ministry bookings",
      body: "Bookings made for an FFSA ministry wing pay the internal rate and no deposit. They wait for the rental manager's approval, and any damage or loss is charged to that wing.",
    },
    {
      heading: "Version",
      body: `Agreement version ${t.agreement_version}.`,
    },
  ];
}
