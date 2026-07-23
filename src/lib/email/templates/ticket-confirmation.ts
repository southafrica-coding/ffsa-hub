import { formatMoney } from "@/lib/currencies";
// FFSA Hub — Ticket confirmation email (transactional).
//
// Inline-CSS HTML, table-based layout for broad email-client
// support (Gmail web/iOS/Android, Apple Mail, Outlook desktop).
// Matches the FFSA HUB cinematic-dark + brand-yellow design
// language used in the admin and on the public storefront.
//
// QR codes are loaded from a public URL endpoint rather than
// embedded as data URIs — clients block large data URIs
// inconsistently. The endpoint sits at /api/tickets/<code>/qr.

const BG = "#0d0b08"; // page background (≈ --surface-1)
const CARD = "#15120e"; // card background (≈ --surface-2)
const INSET = "#1a1611"; // ticket-row inset (≈ --surface-3)
const BORDER = "#2a241d"; // borders (≈ --surface-4)
const TEXT = "#f0ebe3"; // body text (≈ --text-primary)
const TEXT_DIM = "#a89b8a"; // secondary text
const TEXT_DIMMER = "#6e6356"; // tertiary text
const YELLOW = "#fbbf24"; // brand yellow (≈ --yellow)

export function ticketConfirmationEmailHtml(opts: {
  buyerFirstName: string;
  eventTitle: string;
  eventDate: string;
  eventLocation: string | null;
  tickets: Array<{ code: string; tierName: string }>;
  orderId: string;
  totalCents: number;
  siteUrl: string;
  /** ISO 4217 code from orders.currency. */
  currency: string;
}): string {
  const money = (cents: number) => formatMoney(cents, opts.currency);
  const base = opts.siteUrl.replace(/\/$/, "");
  const ticketsCount = opts.tickets.length;
  const ticketWord = ticketsCount > 1 ? "tickets are" : "ticket is";
  const qrPlural = ticketsCount > 1 ? "codes" : "code";

  const ticketsHtml = opts.tickets
    .map(
      (t, i) => `
      <tr>
        <td style="padding:24px 18px;border:1px solid ${BORDER};border-radius:12px;background:${INSET};text-align:center;">
          <img
            src="${base}/api/tickets/${encodeURIComponent(t.code)}/qr"
            alt="Ticket ${i + 1} QR code"
            width="240"
            height="240"
            style="display:block;margin:0 auto;background:#ffffff;padding:10px;border-radius:8px;width:240px;height:240px;"
          />
          <p style="margin:18px 0 6px 0;font-family:Helvetica,Arial,sans-serif;font-size:10px;color:${YELLOW};letter-spacing:0.22em;text-transform:uppercase;font-weight:700;">Ticket ${i + 1} of ${ticketsCount}</p>
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;color:${TEXT};letter-spacing:0.01em;">${escapeHtml(t.tierName)}</p>
          <p style="margin:8px 0 0 0;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:11px;color:${TEXT_DIMMER};letter-spacing:0.08em;">${escapeHtml(t.code)}</p>
        </td>
      </tr>
      <tr><td style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Your tickets for ${escapeHtml(opts.eventTitle)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:Helvetica,Arial,sans-serif;color:${TEXT};">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${BG};padding:36px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;background:${CARD};border:1px solid ${BORDER};border-radius:14px;overflow:hidden;">

        <!-- Top accent strip — brand yellow -->
        <tr>
          <td style="height:5px;background:${YELLOW};line-height:5px;font-size:0;">&nbsp;</td>
        </tr>

        <!-- Brand wordmark -->
        <tr>
          <td align="center" style="padding:26px 32px 4px 32px;">
            <img
              src="${base}/brand/ff-wordmark-white@email.png"
              alt="Fire &amp; Fragrance"
              width="180"
              height="21"
              style="display:block;margin:0 auto;width:180px;height:auto;max-width:55%;"
            />
          </td>
        </tr>

        <!-- Header — eyebrow + title in display style -->
        <tr>
          <td style="padding:18px 32px 8px 32px;">
            <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:700;color:${YELLOW};letter-spacing:0.3em;text-transform:uppercase;">Your Tickets</p>
            <h1 style="margin:10px 0 0 0;font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:32px;line-height:1.05;color:${TEXT};font-weight:900;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(opts.eventTitle)}</h1>
            <p style="margin:10px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${TEXT_DIM};letter-spacing:0.01em;">${escapeHtml(opts.eventDate)}${opts.eventLocation ? ` · ${escapeHtml(opts.eventLocation)}` : ""}</p>
          </td>
        </tr>

        <!-- Intro -->
        <tr>
          <td style="padding:18px 32px 0 32px;">
            <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${TEXT};line-height:1.6;">Hi ${escapeHtml(opts.buyerFirstName)}, your ${ticketsCount} ${ticketWord} confirmed. Show the QR ${qrPlural} below at the door.</p>
          </td>
        </tr>

        <tr><td style="height:22px;line-height:22px;font-size:0;">&nbsp;</td></tr>

        <!-- Tickets -->
        <tr>
          <td style="padding:0 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              ${ticketsHtml}
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:12px 32px 30px 32px;border-top:1px solid ${BORDER};">
            <p style="margin:16px 0 4px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${TEXT_DIM};letter-spacing:0.04em;">Order #${escapeHtml(opts.orderId.slice(0, 8))} · Total ${money(opts.totalCents)}</p>
            <p style="margin:8px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${TEXT_DIMMER};">Questions? Reply to this email.</p>
          </td>
        </tr>

      </table>

      <!-- Sub-card brand line -->
      <p style="margin:18px 0 4px 0;font-family:Helvetica,Arial,sans-serif;font-size:10px;color:${TEXT_DIMMER};letter-spacing:0.3em;text-transform:uppercase;font-weight:700;">Fire &amp; Fragrance South Africa · Hub</p>
      <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:10px;color:${TEXT_DIMMER};letter-spacing:0.04em;"><a href="${base}" style="color:${TEXT_DIMMER};text-decoration:none;">ffsahub.com</a></p>

    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
