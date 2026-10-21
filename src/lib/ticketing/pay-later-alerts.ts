// Staff alerts for "Invoice me, pay later" — so a failed invoice is seen the
// same day, not discovered by finance as a column of cancelled orders. Posted
// to the ticket-report channel (SLACK_TICKETS_REPORT_CHANNEL_ID, else
// SLACK_ACTIVITY_CHANNEL_ID). Best-effort: never throws, never blocks a buyer.

import { postMessage } from "@/lib/slack/client";

const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL || "https://www.ffsahub.com").replace(/\/$/, "");

function channel(): string | null {
  if (!process.env.SLACK_BOT_TOKEN) return null;
  return process.env.SLACK_TICKETS_REPORT_CHANNEL_ID || process.env.SLACK_ACTIVITY_CHANNEL_ID || null;
}

async function post(text: string) {
  const ch = channel();
  if (!ch) return;
  try {
    const res = await postMessage({ channel: ch, text });
    if (!res.ok) console.error("[pay-later-alert] Slack post failed", res.error);
  } catch (err) {
    console.error("[pay-later-alert] Slack post threw", err);
  }
}

/** One buyer's invoice couldn't be made; their order is on hold, seats kept. */
export function invoiceFailureAlertText(a: {
  eventId: string;
  eventTitle: string;
  buyerName: string;
  buyerEmail: string;
  country: string | null;
  error: string;
}): string {
  return [
    `:warning: *Pay-later invoice couldn't be created* — ${a.eventTitle}`,
    `${a.buyerName} (${a.buyerEmail}${a.country ? `, ${a.country}` : ""}) asked to be invoiced. Their seats are held and they were told the invoice is on its way.`,
    `*Why:* ${a.error}`,
    `Fix it, then press *Retry invoice* on the order: ${SITE()}/events/${a.eventId}?tab=orders`,
  ].join("\n");
}

export async function alertInvoiceFailure(a: Parameters<typeof invoiceFailureAlertText>[0]) {
  await post(invoiceFailureAlertText(a));
}

/** The daily check: events offering pay-later whose Xero item is missing somewhere. */
export async function alertPayLaterHealth(lines: string[]) {
  if (lines.length === 0) return;
  await post([":rotating_light: *Pay-later setup needs attention*", ...lines.map((l) => `• ${l}`)].join("\n"));
}
