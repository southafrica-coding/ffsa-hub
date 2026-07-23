// FFSA Hub — Ticket confirmation email for FFSA CAMPS.
//
// Same shape as the generic ticket-confirmation template (inline-CSS,
// table-based, QR codes loaded from /api/tickets/<code>/qr) but
// re-skinned to the FFSA Camps aesthetic — bright blue + cream, deep-ink
// surround, heavy *italic* display lockup, full GenZ voice.
//
// Email-safe choices:
//   - Only system fonts (Aileron-stack falls back to Helvetica/Arial;
//     real Aileron loads the day it's self-hosted). No webfonts.
//   - No CSS classes (clients strip <style>); everything inline.
//   - Single 600px-wide table; nested tables for ticket stubs.
//   - Critical entry info (QR, code, date, venue, total) stays legible —
//     the GenZ copy decorates around it, never obscures it.

import { CAMPS_COLORS, CAMPS_FONTS, CAMPS_SLOGAN, CAMPS_VISION } from "../ffsa-camps-shell";
import { formatMoney } from "@/lib/currencies";

const { BLUE, CREAM, WHITE, INK } = CAMPS_COLORS;
const { DISPLAY, BODY } = CAMPS_FONTS;

// Heavy italic display style shared by every headline-level element.
const D = `font-family:${DISPLAY};font-style:italic;font-weight:900;`;

// Ticket stubs alternate between blue and ink so a strip of passes reads
// like differently-stamped tickets while staying in the blue/cream family.
const STUB_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: BLUE, fg: CREAM },
  { bg: INK, fg: CREAM },
];

export function campsTicketEmailHtml(opts: {
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
  const base = opts.siteUrl.replace(/\/$/, "");
  const money = (cents: number) => formatMoney(cents, opts.currency);
  const count = opts.tickets.length;
  const passWord = count === 1 ? "pass is" : "passes are";
  const qrWord = count === 1 ? "code" : "codes";
  const venueLine = opts.eventLocation || "Venue TBA";

  const ticketsHtml = opts.tickets
    .map((t, i) => {
      const palette = STUB_PALETTE[i % STUB_PALETTE.length];
      const serial = String(i + 1).padStart(3, "0");
      return `
      <tr>
        <td style="padding:0;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;border:3px solid ${BLUE};background:${WHITE};">
            <tr>
              <!-- Coloured stub: ADMIT ONE + serial -->
              <td valign="middle" align="center" width="68" style="background:${palette.bg};color:${palette.fg};padding:18px 0;border-right:3px dashed ${BLUE};">
                <p style="margin:0;${D}font-size:13px;letter-spacing:0.12em;line-height:1.1;text-transform:uppercase;">ADMIT</p>
                <p style="margin:2px 0 0 0;${D}font-size:13px;letter-spacing:0.12em;line-height:1.1;text-transform:uppercase;">ONE</p>
                <p style="margin:10px 0 0 0;font-family:${BODY};font-size:10px;font-weight:700;letter-spacing:0.12em;opacity:0.9;">${serial}</p>
              </td>
              <!-- Ticket body: name + QR + code -->
              <td style="padding:20px 22px;background:${WHITE};color:${INK};">
                <p style="margin:0 0 4px 0;font-family:${BODY};font-size:10px;font-weight:700;color:${BLUE};letter-spacing:0.18em;text-transform:uppercase;">PASS ${i + 1} / ${count}</p>
                <h2 style="margin:0;${D}font-size:24px;line-height:1.02;color:${INK};letter-spacing:-0.005em;text-transform:uppercase;">${escapeHtml(t.tierName)}</h2>
                <div style="text-align:center;margin:18px 0 6px 0;">
                  <img
                    src="${base}/api/tickets/${encodeURIComponent(t.code)}/qr"
                    alt="QR code for pass ${i + 1}"
                    width="220"
                    height="220"
                    style="display:inline-block;background:#ffffff;padding:10px;border:2px solid ${BLUE};width:220px;height:220px;"
                  />
                </div>
                <p style="margin:8px 0 0 0;font-family:${BODY};font-size:12px;font-weight:700;color:${INK};letter-spacing:0.06em;text-align:center;">CODE: ${escapeHtml(t.code)}</p>
                <div style="margin:14px 0 0 0;border-top:1px dashed ${BLUE};padding-top:10px;">
                  <p style="margin:0;font-family:${BODY};font-size:10px;font-weight:700;letter-spacing:0.08em;color:${BLUE};text-transform:uppercase;text-align:center;">ADMIT ONE &middot; ${escapeHtml(venueLine.toUpperCase())} &middot; ${escapeHtml(opts.eventDate.toUpperCase())}</p>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr><td style="height:18px;line-height:18px;font-size:0;">&nbsp;</td></tr>`;
    })
    .join("");

  // Ticker — slogan repeated, sized to fit a 600px email.
  const ticker = `${CAMPS_SLOGAN}&nbsp;&nbsp;&#10022;&nbsp;&nbsp;${CAMPS_SLOGAN}&nbsp;&nbsp;&#10022;`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>You're in — ${escapeHtml(opts.eventTitle)}</title>
</head>
<body style="margin:0;padding:0;background:${INK};font-family:${BODY};color:${INK};">
  <!-- Preheader (hidden) — sets Gmail/iOS inbox preview text -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${INK};">
    you're in, no cap. ${escapeHtml(opts.eventTitle)} is locked. ${count} ${passWord} attached.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${INK};padding:30px 10px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:${CREAM};table-layout:fixed;">

        <!-- Blue ticker bar -->
        <tr>
          <td style="background:${BLUE};border-bottom:2px solid ${CREAM};padding:8px 14px;${D}font-size:13px;color:${CREAM};letter-spacing:0.16em;text-transform:uppercase;line-height:1.2;overflow:hidden;white-space:nowrap;text-align:center;">
            ${ticker}
          </td>
        </tr>

        <!-- Blue masthead -->
        <tr>
          <td style="background:${BLUE};padding:16px 22px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td valign="middle" style="${D}font-size:22px;color:${CREAM};letter-spacing:-0.01em;text-transform:uppercase;line-height:1;">
                  FFSA&nbsp;CAMPS
                </td>
                <td valign="middle" align="right" style="font-family:${BODY};font-size:10px;font-weight:700;color:${CREAM};letter-spacing:0.18em;text-transform:uppercase;">
                  SOUTH&nbsp;AFRICA / MMXXVI
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Hero -->
        <tr>
          <td style="background:${BLUE};color:${CREAM};padding:36px 28px 32px 28px;">
            <p style="margin:0;font-family:${BODY};font-size:11px;font-weight:700;color:${CREAM};letter-spacing:0.2em;text-transform:uppercase;opacity:0.92;">
              Pass Confirmed&nbsp;&nbsp;&middot;&nbsp;&nbsp;${escapeHtml(opts.eventDate)}
            </p>
            <h1 style="margin:14px 0 0 0;${D}font-size:64px;line-height:0.92;color:${CREAM};letter-spacing:0.005em;text-transform:uppercase;">
              YOU&rsquo;RE IN.
            </h1>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;">
              <tr>
                <td style="background:${CREAM};color:${BLUE};padding:8px 14px;${D}font-size:15px;letter-spacing:0.08em;text-transform:uppercase;">
                  ${CAMPS_SLOGAN} &#129310;
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Coordinates: DATES / VENUE / ORDER -->
        <tr>
          <td style="background:${BLUE};padding:0 28px 28px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid rgba(242,232,204,0.3);border-collapse:collapse;">
              ${row("DATES", opts.eventDate)}
              ${row("VENUE", venueLine)}
              ${row("ORDER", `#${opts.orderId.slice(0, 8).toUpperCase()}`)}
            </table>
          </td>
        </tr>

        <!-- Intro on cream paper -->
        <tr>
          <td style="background:${CREAM};color:${INK};padding:30px 28px 8px 28px;">
            <p style="margin:0;font-family:${BODY};font-size:11px;font-weight:700;color:${BLUE};letter-spacing:0.2em;text-transform:uppercase;">The briefing</p>
            <h2 style="margin:10px 0 0 0;${D}font-size:26px;line-height:1.05;color:${INK};letter-spacing:0.005em;text-transform:uppercase;">
              hi ${escapeHtml(opts.buyerFirstName)} &mdash; your ${count} ${passWord} secured &#10024;
            </h2>
            <p style="margin:14px 0 0 0;font-family:${BODY};font-size:14px;line-height:1.65;color:${INK};">
              show the QR ${qrWord} below at the door &mdash; screenshot it, print it, or pull this email up live, it all works fr. save this email, it&rsquo;s literally your ticket bestie &#128153;
            </p>
          </td>
        </tr>

        <tr><td style="background:${CREAM};height:24px;line-height:24px;font-size:0;">&nbsp;</td></tr>

        <!-- Tickets -->
        <tr>
          <td style="background:${CREAM};padding:0 28px;">
            <p style="margin:0 0 14px 0;font-family:${BODY};font-size:11px;font-weight:700;color:${BLUE};letter-spacing:0.2em;text-transform:uppercase;">Your passes</p>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              ${ticketsHtml}
            </table>
          </td>
        </tr>

        <!-- Order summary on cream -->
        <tr>
          <td style="background:${CREAM};padding:0 28px 28px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-top:3px solid ${BLUE};border-bottom:3px solid ${BLUE};">
              <tr>
                <td style="padding:14px 0;${D}font-size:13px;color:${INK};letter-spacing:0.12em;text-transform:uppercase;">
                  Total Paid
                </td>
                <td align="right" style="padding:14px 0;${D}font-size:24px;color:${BLUE};letter-spacing:0.005em;">
                  ${money(opts.totalCents)}
                </td>
              </tr>
            </table>
            <p style="margin:14px 0 0 0;font-family:${BODY};font-size:11px;font-weight:700;color:${INK};opacity:0.75;letter-spacing:0.06em;text-transform:uppercase;">
              questions? just reply to this email &mdash; we got you &#128591;
            </p>
          </td>
        </tr>

        <!-- Blue footer -->
        <tr>
          <td style="background:${BLUE};color:${CREAM};padding:26px 28px;text-align:center;">
            <p style="margin:0;${D}font-size:24px;color:${CREAM};letter-spacing:-0.01em;text-transform:uppercase;line-height:1;">
              FFSA&nbsp;CAMPS
            </p>
            <p style="margin:14px 0 0;font-family:${BODY};font-size:12px;font-style:italic;line-height:1.6;color:${CREAM};opacity:0.92;max-width:420px;margin-left:auto;margin-right:auto;">
              ${escapeHtml(CAMPS_VISION)}
            </p>
            <p style="margin:14px 0 0 0;font-family:${BODY};font-size:10px;font-weight:700;color:${CREAM};letter-spacing:0.2em;text-transform:uppercase;opacity:0.85;">
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
      <td style="background:${BLUE};padding:10px 12px;border-top:1px solid rgba(242,232,204,0.3);">
        <span style="font-family:${BODY};font-size:10px;font-weight:700;color:${CREAM};letter-spacing:0.18em;text-transform:uppercase;display:block;opacity:0.85;">${escapeHtml(k)}</span>
        <span style="font-family:${BODY};font-size:13px;color:${CREAM};letter-spacing:0.02em;display:block;margin-top:3px;">${escapeHtml(v)}</span>
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
