import { eventLogoBlock } from "../event-sender";
import { formatMoney } from "@/lib/currencies";
import {
  FE,
  feEsc,
  feEyebrow,
  feHeading,
  feParagraph,
  feStrong,
  feCoords,
  feSpacer,
  ffsaEmailDocument,
} from "../ffsa-chrome";

// FFSA Hub — Ticket confirmation email (transactional), for 'ff'-brand
// events. Renders in the canonical FFSA editorial-black chrome so the
// buyer's receipt matches the ticketing landing page they just bought on.
//
// QR codes load from a public URL endpoint (/api/tickets/<code>/qr)
// rather than data URIs — clients block large data URIs inconsistently.

export function ticketConfirmationEmailHtml(opts: {
  buyerFirstName: string;
  eventTitle: string;
  eventDate: string;
  eventLocation: string | null;
  tickets: Array<{ code: string; tierName: string }>;
  orderId: string;
  totalCents: number;
  siteUrl: string;
  /** The event's own logo, shown first when it asked for one (migration 241). */
  headerLogoUrl?: string | null;
  /** ISO 4217 code from orders.currency. */
  currency: string;
}): string {
  const money = (cents: number) => formatMoney(cents, opts.currency);
  const base = opts.siteUrl.replace(/\/$/, "");
  const ticketsCount = opts.tickets.length;
  const ticketWord = ticketsCount > 1 ? "tickets are" : "ticket is";
  const qrPlural = ticketsCount > 1 ? "codes" : "code";

  // Each ticket — a dark inset panel with the QR on a white chip, the tier
  // name in Roboto Black, and the mono code.
  const ticketsHtml = opts.tickets
    .map(
      (t, i) => `
      <tr>
        <td bgcolor="#0B0B0B" style="padding:26px 18px;border:1px solid ${FE.LINE};border-radius:16px;background:${FE.SURFACE};text-align:center;">
          <img
            src="${base}/api/tickets/${encodeURIComponent(t.code)}/qr"
            alt="Ticket ${i + 1} QR code"
            width="236"
            height="236"
            style="display:block;margin:0 auto;background:#ffffff;padding:12px;border-radius:10px;width:236px;height:236px;"
          />
          <p style="margin:20px 0 8px 0;font-family:'Space Mono','Roboto Mono',monospace;font-size:10px;color:${FE.YELLOW};letter-spacing:0.22em;text-transform:uppercase;font-weight:700;">Ticket ${i + 1} of ${ticketsCount}</p>
          <p style="margin:0;font-family:'Roboto','Arial Black',Arial,sans-serif;font-size:18px;font-weight:900;letter-spacing:-0.01em;text-transform:uppercase;color:${FE.WHITE};">${feEsc(t.tierName)}</p>
          <p style="margin:9px 0 0 0;font-family:'Space Mono','Roboto Mono',monospace;font-size:11px;color:${FE.DIM};letter-spacing:0.1em;">${feEsc(t.code)}</p>
        </td>
      </tr>
      <tr><td style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>`
    )
    .join("");

  const meta = [
    { label: "When", value: opts.eventDate },
    ...(opts.eventLocation
      ? [{ label: "Where", value: opts.eventLocation }]
      : []),
  ];

  const body = `${eventLogoBlock(opts.headerLogoUrl, opts.eventTitle)}${feEyebrow("Your tickets")}${feHeading(opts.eventTitle)}${feCoords(
    meta
  )}${feParagraph(
    `Hi ${feStrong(feEsc(opts.buyerFirstName))}, your ${ticketsCount} ${ticketWord} confirmed. Show the QR ${qrPlural} below at the door.`
  )}${feSpacer("md")}
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${ticketsHtml}</table>
  <div style="margin:18px 0 0;padding-top:18px;border-top:1px solid ${FE.LINE};">
    <p style="margin:0;font-family:'Space Mono','Roboto Mono',monospace;font-size:12px;color:${FE.DIM};letter-spacing:0.04em;">Order #${feEsc(
      opts.orderId.slice(0, 8)
    )}&nbsp;&nbsp;&middot;&nbsp;&nbsp;Total ${money(opts.totalCents)}</p>
    <p style="margin:9px 0 0;font-family:'Roboto',Arial,sans-serif;font-size:13px;color:${FE.BONE};">Questions? Just reply to this email.</p>
  </div>`;

  return ffsaEmailDocument({
    title: `Your tickets for ${opts.eventTitle}`,
    previewText: `Your ${ticketsCount} ${ticketWord} confirmed — QR ${qrPlural} inside.`,
    siteUrl: opts.siteUrl,
    bodyHtml: body,
  });
}
