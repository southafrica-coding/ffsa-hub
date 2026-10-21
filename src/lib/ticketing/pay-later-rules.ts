// The pure rules behind "Invoice me, pay later" (src/lib/ticketing/pay-later.ts),
// kept apart from the Xero and ticket-settling code so they're tested directly.

import { getXeroRegionForStudent, type XeroRegion } from "@/services/xero";

/**
 * Which Xero organisation invoices a pay-later buyer: their country, exactly
 * as students are routed in Training (USA → US, everyone else → SA). Orders
 * from before buyers were asked fall back to the event currency, which is
 * how they were routed then.
 */
export function xeroRegionForOrder(order: { buyer_country: string | null; currency: string | null }): XeroRegion {
  if (order.buyer_country?.trim()) return getXeroRegionForStudent(order.buyer_country);
  return (order.currency ?? "ZAR").toUpperCase() === "USD" ? "us" : "za";
}

/** Today in South Africa (Vercel renders in UTC), as YYYY-MM-DD. */
export function todayYmd(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

/** The event's due date (or its start date), never in the past. */
export function invoiceDueDate(
  event: { pay_later_due_date: string | null; start_date: string | null },
  today: string = todayYmd()
): string {
  const due = event.pay_later_due_date ?? event.start_date ?? today;
  return due < today ? today : due;
}

/**
 * A Xero item code suggestion from the event title: initials of the words
 * plus a 2-digit year if one is in the title ("Preachers 2026" → "PREACHERS26",
 * "FF Global Leaders Gathering" → "FFGLG"). Xero codes max out at 30 chars.
 */
export function suggestItemCode(title: string): string {
  const yearMatch = title.match(/\b(20\d{2})\b/);
  const words = title
    .replace(/\b20\d{2}\b/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const base =
    words.length === 1
      ? words[0].toUpperCase()
      : words.map((w) => (/^[A-Z]{2,}$/.test(w) ? w : w[0].toUpperCase())).join("");
  return `${base}${yearMatch ? yearMatch[1].slice(2) : ""}`.slice(0, 30) || "EVENT";
}

/**
 * Which Xero orgs are missing an event's item. Buyers are invoiced in their
 * own country's org, so an event offering pay-later needs it in BOTH.
 */
export function missingItemOrgs(
  itemCode: string | null | undefined,
  codesByOrg: Record<XeroRegion, string[] | null>
): XeroRegion[] {
  const want = itemCode?.trim().toLowerCase();
  return (["za", "us"] as XeroRegion[]).filter((r) => {
    const codes = codesByOrg[r];
    if (codes === null) return false; // couldn't read that org — don't cry wolf
    return !want || !codes.some((c) => c.trim().toLowerCase() === want);
  });
}
