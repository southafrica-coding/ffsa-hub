import { eventMessageHtml } from "../event-email-wording";
import { formatMoney } from "@/lib/currencies";
// FFSA Hub — Ticket confirmation email for MISSIO.
//
// Same shape as the generic ticket-confirmation template (inline-CSS,
// table-based, QR codes loaded from /api/tickets/<code>/qr) but
// re-skinned to the MISSIO aesthetic — built around the official MISSIŌ
// wordmark: warm off-white paper, near-black type and 1px rules, bold
// Archivo caps, square corners, no accent colour.
//
// Email-safe choices:
//   - Archivo pulled via <link> for webfont-capable clients; falls back to
//     Helvetica/Arial everywhere else. Everything inline (clients strip <style>).
//   - Single 600px-wide table; nested tables for ticket stubs.
//   - Critical entry info (QR, code, date, venue, total) stays legible —
//     the QR sits on a white chip with a 1px black frame.
//   - The masthead shows the event's own logo when it has one, otherwise
//     the MISSIŌ wordmark PNG.

import {
  MISSIO_COLORS,
  MISSIO_FONTS,
  MISSIO_FONT_LINK,
  MISSIO_SLOGAN,
  MISSIO_VISION,
  missioWordmarkImg,
} from "../missio-shell";

const { BG, SURFACE, PAPER, INK, MUTED, HAIRLINE, ON_INK } = MISSIO_COLORS;
const { DISPLAY, BODY } = MISSIO_FONTS;

// Bold display style shared by every headline-level element.
const D = `font-family:${DISPLAY};font-weight:800;`;

export function missioTicketEmailHtml(opts: {
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
  /** The event's own message, between the opening and the tickets (migration 242). */
  message?: string | null;
  /** ISO 4217 code from orders.currency. */
  currency: string;
}): string {
  const base = opts.siteUrl.replace(/\/$/, "");
  const money = (cents: number) => formatMoney(cents, opts.currency);
  const count = opts.tickets.length;
  const passWord = count === 1 ? "pass is" : "passes are";
  const qrWord = count === 1 ? "code" : "codes";
  const venueLine = opts.eventLocation || "Venue TBA";

  const ticketsHtml = opts.tickets
    .map((t, i) => {
      const serial = String(i + 1).padStart(3, "0");
      return `
      <tr>
        <td style="padding:0;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;border:1px solid ${INK};background:${PAPER};">
            <tr>
              <!-- Stub: ADMIT ONE + serial -->
              <td valign="middle" align="center" width="68" style="background:${INK};color:${ON_INK};padding:18px 0;">
                <p style="margin:0;${D}font-size:13px;letter-spacing:0.12em;line-height:1.1;text-transform:uppercase;color:${ON_INK};">ADMIT</p>
                <p style="margin:2px 0 0 0;${D}font-size:13px;letter-spacing:0.12em;line-height:1.1;text-transform:uppercase;color:${ON_INK};">ONE</p>
                <p style="margin:10px 0 0 0;font-family:${BODY};font-size:10px;font-weight:700;letter-spacing:0.12em;color:${ON_INK};">${serial}</p>
              </td>
              <!-- Ticket body: name + QR + code -->
              <td style="padding:22px 24px;background:${PAPER};color:${INK};">
                <p style="margin:0 0 6px 0;font-family:${BODY};font-size:10px;font-weight:700;color:${MUTED};letter-spacing:0.18em;text-transform:uppercase;">PASS ${i + 1} / ${count}</p>
                <h2 style="margin:0;${D}font-size:26px;line-height:1.02;color:${INK};letter-spacing:-0.01em;text-transform:uppercase;">${escapeHtml(t.tierName)}</h2>
                <div style="text-align:center;margin:20px 0 6px 0;">
                  <img
                    src="${base}/api/tickets/${encodeURIComponent(t.code)}/qr"
                    alt="QR code for pass ${i + 1}"
                    width="220"
                    height="220"
                    style="display:inline-block;background:#ffffff;padding:10px;border:1px solid ${INK};width:220px;height:220px;"
                  />
                </div>
                <p style="margin:8px 0 0 0;font-family:${BODY};font-size:12px;font-weight:700;color:${INK};letter-spacing:0.06em;text-align:center;">CODE: ${escapeHtml(t.code)}</p>
                <div style="margin:16px 0 0 0;border-top:1px solid ${HAIRLINE};padding-top:10px;">
                  <p style="margin:0;font-family:${BODY};font-size:10px;font-weight:700;letter-spacing:0.08em;color:${MUTED};text-transform:uppercase;text-align:center;">ADMIT ONE &middot; ${escapeHtml(venueLine.toUpperCase())} &middot; ${escapeHtml(opts.eventDate.toUpperCase())}</p>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr><td style="height:18px;line-height:18px;font-size:0;">&nbsp;</td></tr>`;
    })
    .join("");

  // The event's own logo wins the masthead; the MISSIŌ wordmark is the default.
  const mastheadMark = opts.headerLogoUrl
    ? `<img src="${escapeHtml(opts.headerLogoUrl)}" alt="${escapeHtml(opts.eventTitle)}" style="display:block;max-width:240px;max-height:72px;width:auto;height:auto;border:0;" />`
    : missioWordmarkImg(base, 132);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>You're in — ${escapeHtml(opts.eventTitle)}</title>
  ${MISSIO_FONT_LINK}
</head>
<body style="margin:0;padding:0;background:${BG};font-family:${BODY};color:${INK};">
  <!-- Preheader (hidden) — sets Gmail/iOS inbox preview text -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${BG};">
    You're in. ${escapeHtml(opts.eventTitle)} is locked. ${count} ${passWord} inside.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${BG};padding:36px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:${PAPER};border:1px solid ${INK};table-layout:fixed;">

        <!-- Masthead -->
        <tr>
          <td style="background:${PAPER};padding:30px 36px 26px;border-bottom:1px solid ${INK};">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td valign="middle">
                  ${mastheadMark}
                </td>
                <td valign="middle" align="right" style="font-family:${BODY};font-size:10px;font-weight:700;color:${MUTED};letter-spacing:0.2em;text-transform:uppercase;">
                  ${MISSIO_SLOGAN}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Hero -->
        <tr>
          <td style="background:${PAPER};color:${INK};padding:44px 36px 32px 36px;">
            <p style="margin:0;font-family:${BODY};font-size:11px;font-weight:700;color:${MUTED};letter-spacing:0.2em;text-transform:uppercase;">
              Pass Confirmed&nbsp;&nbsp;&middot;&nbsp;&nbsp;${escapeHtml(opts.eventDate)}
            </p>
            <h1 style="margin:16px 0 0 0;${D}font-size:64px;line-height:0.95;color:${INK};letter-spacing:-0.02em;text-transform:uppercase;">
              YOU&rsquo;RE IN.
            </h1>
          </td>
        </tr>

        <!-- Coordinates: DATES / VENUE / ORDER -->
        <tr>
          <td style="background:${PAPER};padding:0 36px 32px 36px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid ${INK};border-collapse:collapse;">
              ${row("DATES", opts.eventDate)}
              ${row("VENUE", venueLine)}
              ${row("ORDER", `#${opts.orderId.slice(0, 8).toUpperCase()}`)}
            </table>
          </td>
        </tr>

        <!-- Intro -->
        <tr>
          <td style="background:${PAPER};color:${INK};padding:32px 36px 8px 36px;border-top:1px solid ${HAIRLINE};">
            <p style="margin:0;font-family:${BODY};font-size:11px;font-weight:700;color:${MUTED};letter-spacing:0.2em;text-transform:uppercase;">The briefing</p>
            <h2 style="margin:12px 0 0 0;${D}font-size:28px;line-height:1.05;color:${INK};letter-spacing:-0.01em;text-transform:uppercase;">
              ${escapeHtml(opts.buyerFirstName)} &mdash; your ${count} ${passWord} secured
            </h2>
            <p style="margin:16px 0 0 0;font-family:${BODY};font-size:15px;line-height:1.7;color:${INK};">
              Show the QR ${qrWord} below at the door &mdash; screenshot it, print it, or pull this email up live. Save this email; it&rsquo;s your ticket in.
            </p>
          </td>
        </tr>

        <tr><td style="background:${PAPER};height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>

        ${opts.message ? `<tr><td style="background:${PAPER};padding:0 36px 24px 36px;">${eventMessageHtml(opts.message, { color: INK, font: BODY })}</td></tr>` : ""}
        <!-- Tickets -->
        <tr>
          <td style="background:${PAPER};padding:0 36px;">
            <p style="margin:0 0 16px 0;font-family:${BODY};font-size:11px;font-weight:700;color:${MUTED};letter-spacing:0.2em;text-transform:uppercase;">Your passes</p>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              ${ticketsHtml}
            </table>
          </td>
        </tr>

        <!-- Order summary -->
        <tr>
          <td style="background:${PAPER};padding:0 36px 36px 36px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${INK};border-bottom:1px solid ${INK};">
              <tr>
                <td style="padding:16px 0;${D}font-size:14px;color:${INK};letter-spacing:0.1em;text-transform:uppercase;">
                  Total Paid
                </td>
                <td align="right" style="padding:16px 0;${D}font-size:28px;color:${INK};letter-spacing:-0.01em;">
                  ${money(opts.totalCents)}
                </td>
              </tr>
            </table>
            <p style="margin:16px 0 0 0;font-family:${BODY};font-size:11px;font-weight:700;color:${MUTED};letter-spacing:0.06em;text-transform:uppercase;">
              Questions? Just reply to this email &mdash; we&rsquo;ve got you.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td align="center" style="background:${SURFACE};color:${INK};padding:32px 36px;text-align:center;border-top:1px solid ${INK};">
            <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td>${missioWordmarkImg(base, 112)}</td></tr></table>
            <p style="margin:16px auto 0;font-family:${BODY};font-size:12px;font-style:italic;line-height:1.6;color:${MUTED};max-width:420px;">
              ${escapeHtml(MISSIO_VISION)}
            </p>
            <p style="margin:14px 0 0 0;font-family:${BODY};font-size:10px;font-weight:700;color:${MUTED};letter-spacing:0.2em;text-transform:uppercase;">
              ${escapeHtml(opts.eventTitle.toUpperCase())} &middot; Powered by FFSA Hub &middot; &copy;&nbsp;MMXXVI
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// One coordinate row inside the hero's data block.
function row(k: string, v: string): string {
  return `
    <tr>
      <td style="background:${PAPER};padding:12px 14px;border-top:1px solid ${INK};">
        <span style="font-family:${BODY};font-size:10px;font-weight:700;color:${MUTED};letter-spacing:0.18em;text-transform:uppercase;display:block;">${escapeHtml(k)}</span>
        <span style="font-family:${BODY};font-size:14px;color:${INK};letter-spacing:0.01em;display:block;margin-top:4px;">${escapeHtml(v)}</span>
      </td>
    </tr>`;
}

function escapeHtml(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
