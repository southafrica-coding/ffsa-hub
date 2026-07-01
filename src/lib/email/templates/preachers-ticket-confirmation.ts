// FFSA Hub — Ticket confirmation email for PREACHERS SA.
//
// Same shape as the generic ticket-confirmation template (inline-CSS,
// table-based, QR codes loaded from /api/tickets/<code>/qr) but
// re-skinned to the PREACHERS aesthetic — DARK gunmetal navy + aged bone,
// near-black ink surround, condensed heavy rock-poster caps, twin
// lightning bolts. Strictly monochrome (no colour accent), per the brand
// artwork.
//
// Email-safe choices:
//   - Only system fonts (Anton-stack falls back to Impact/Arial Narrow;
//     real Anton loads the day it's self-hosted). No webfonts.
//   - No CSS classes (clients strip <style>); everything inline.
//   - Single 600px-wide table; nested tables for ticket stubs.
//   - Critical entry info (QR, code, date, venue, total) stays legible —
//     the QR sits on a white chip so scanners read it against the dark UI.

import {
  PREACHERS_COLORS,
  PREACHERS_FONTS,
  PREACHERS_FONT_LINK,
  PREACHERS_SLOGAN,
  PREACHERS_VISION,
} from "../preachers-shell";

const { NAVY, INK, BONE, OFFWHITE, LINE } = PREACHERS_COLORS;
const { DISPLAY, BODY } = PREACHERS_FONTS;

// Heavy condensed display style shared by every headline-level element.
const D = `font-family:${DISPLAY};font-weight:900;`;

// Lightning-bolt device.
const BOLT = "&#9889;";

export function preachersTicketEmailHtml(opts: {
  buyerFirstName: string;
  eventTitle: string;
  eventDate: string;
  eventLocation: string | null;
  tickets: Array<{ code: string; tierName: string }>;
  orderId: string;
  totalCents: number;
  siteUrl: string;
}): string {
  const base = opts.siteUrl.replace(/\/$/, "");
  const rands = (cents: number) =>
    `R${(cents / 100).toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
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
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;border:2px solid ${LINE};background:${INK};">
            <tr>
              <!-- Stub: ADMIT ONE + serial -->
              <td valign="middle" align="center" width="68" style="background:${NAVY};color:${BONE};padding:18px 0;border-right:2px dashed ${LINE};">
                <p style="margin:0;${D}font-size:14px;letter-spacing:0.1em;line-height:1.1;text-transform:uppercase;">ADMIT</p>
                <p style="margin:2px 0 0 0;${D}font-size:14px;letter-spacing:0.1em;line-height:1.1;text-transform:uppercase;">ONE</p>
                <p style="margin:10px 0 0 0;font-family:${BODY};font-size:10px;font-weight:700;letter-spacing:0.12em;opacity:0.7;">${serial}</p>
              </td>
              <!-- Ticket body: name + QR + code -->
              <td style="padding:20px 22px;background:${INK};color:${OFFWHITE};">
                <p style="margin:0 0 4px 0;font-family:${BODY};font-size:10px;font-weight:700;color:${BONE};letter-spacing:0.18em;text-transform:uppercase;opacity:0.75;">PASS ${i + 1} / ${count}</p>
                <h2 style="margin:0;${D}font-size:28px;line-height:1.0;color:${BONE};letter-spacing:0.02em;text-transform:uppercase;">${escapeHtml(t.tierName)}</h2>
                <div style="text-align:center;margin:18px 0 6px 0;">
                  <img
                    src="${base}/api/tickets/${encodeURIComponent(t.code)}/qr"
                    alt="QR code for pass ${i + 1}"
                    width="220"
                    height="220"
                    style="display:inline-block;background:#ffffff;padding:10px;border:2px solid ${BONE};width:220px;height:220px;"
                  />
                </div>
                <p style="margin:8px 0 0 0;font-family:${BODY};font-size:12px;font-weight:700;color:${OFFWHITE};letter-spacing:0.06em;text-align:center;">CODE: ${escapeHtml(t.code)}</p>
                <div style="margin:14px 0 0 0;border-top:1px dashed ${LINE};padding-top:10px;">
                  <p style="margin:0;font-family:${BODY};font-size:10px;font-weight:700;letter-spacing:0.08em;color:${BONE};opacity:0.7;text-transform:uppercase;text-align:center;">ADMIT ONE &middot; ${escapeHtml(venueLine.toUpperCase())} &middot; ${escapeHtml(opts.eventDate.toUpperCase())}</p>
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
  const ticker = `${PREACHERS_SLOGAN}&nbsp;&nbsp;${BOLT}&nbsp;&nbsp;${PREACHERS_SLOGAN}&nbsp;&nbsp;${BOLT}&nbsp;&nbsp;${PREACHERS_SLOGAN}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>You're in — ${escapeHtml(opts.eventTitle)}</title>
  ${PREACHERS_FONT_LINK}
</head>
<body style="margin:0;padding:0;background:${INK};font-family:${BODY};color:${OFFWHITE};">
  <!-- Preheader (hidden) — sets Gmail/iOS inbox preview text -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${NAVY};">
    You're in. ${escapeHtml(opts.eventTitle)} is locked. ${count} ${passWord} inside.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${INK};padding:30px 10px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:${NAVY};table-layout:fixed;">

        <!-- Ink ticker bar -->
        <tr>
          <td style="background:${INK};border-bottom:1px solid ${LINE};padding:8px 14px;${D}font-size:14px;color:${BONE};letter-spacing:0.22em;text-transform:uppercase;line-height:1.2;overflow:hidden;white-space:nowrap;text-align:center;">
            ${ticker}
          </td>
        </tr>

        <!-- Ink masthead -->
        <tr>
          <td style="background:${INK};padding:16px 22px;border-bottom:1px solid ${LINE};">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td valign="middle" style="${D}font-size:24px;color:${BONE};letter-spacing:0.03em;text-transform:uppercase;line-height:1;">
                  ${BOLT}&nbsp;PREACHERS&nbsp;${BOLT}
                </td>
                <td valign="middle" align="right" style="font-family:${BODY};font-size:10px;font-weight:700;color:${BONE};letter-spacing:0.18em;text-transform:uppercase;opacity:0.7;">
                  SOUTH&nbsp;AFRICA
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Hero -->
        <tr>
          <td style="background:${NAVY};color:${BONE};padding:36px 28px 32px 28px;">
            <p style="margin:0;font-family:${BODY};font-size:11px;font-weight:700;color:${OFFWHITE};letter-spacing:0.2em;text-transform:uppercase;opacity:0.7;">
              Pass Confirmed&nbsp;&nbsp;&middot;&nbsp;&nbsp;${escapeHtml(opts.eventDate)}
            </p>
            <h1 style="margin:14px 0 0 0;${D}font-size:72px;line-height:0.9;color:${BONE};letter-spacing:0.02em;text-transform:uppercase;">
              YOU&rsquo;RE IN.
            </h1>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;">
              <tr>
                <td style="background:${BONE};color:${INK};padding:9px 16px;${D}font-size:18px;letter-spacing:0.08em;text-transform:uppercase;">
                  ${PREACHERS_SLOGAN}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Coordinates: DATES / VENUE / ORDER -->
        <tr>
          <td style="background:${NAVY};padding:0 28px 28px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid ${LINE};border-collapse:collapse;">
              ${row("DATES", opts.eventDate)}
              ${row("VENUE", venueLine)}
              ${row("ORDER", `#${opts.orderId.slice(0, 8).toUpperCase()}`)}
            </table>
          </td>
        </tr>

        <!-- Intro on navy paper -->
        <tr>
          <td style="background:${NAVY};color:${OFFWHITE};padding:30px 28px 8px 28px;border-top:1px solid ${LINE};">
            <p style="margin:0;font-family:${BODY};font-size:11px;font-weight:700;color:${BONE};letter-spacing:0.2em;text-transform:uppercase;opacity:0.75;">The briefing</p>
            <h2 style="margin:10px 0 0 0;${D}font-size:30px;line-height:1.02;color:${BONE};letter-spacing:0.02em;text-transform:uppercase;">
              ${escapeHtml(opts.buyerFirstName)} &mdash; your ${count} ${passWord} secured
            </h2>
            <p style="margin:14px 0 0 0;font-family:${BODY};font-size:14px;line-height:1.65;color:${OFFWHITE};">
              Show the QR ${qrWord} below at the door &mdash; screenshot it, print it, or pull this email up live. Save this email; it&rsquo;s your ticket in.
            </p>
          </td>
        </tr>

        <tr><td style="background:${NAVY};height:24px;line-height:24px;font-size:0;">&nbsp;</td></tr>

        <!-- Tickets -->
        <tr>
          <td style="background:${NAVY};padding:0 28px;">
            <p style="margin:0 0 14px 0;font-family:${BODY};font-size:11px;font-weight:700;color:${BONE};letter-spacing:0.2em;text-transform:uppercase;opacity:0.75;">Your passes</p>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              ${ticketsHtml}
            </table>
          </td>
        </tr>

        <!-- Order summary on navy -->
        <tr>
          <td style="background:${NAVY};padding:0 28px 28px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-top:2px solid ${BONE};border-bottom:2px solid ${BONE};">
              <tr>
                <td style="padding:14px 0;${D}font-size:15px;color:${BONE};letter-spacing:0.1em;text-transform:uppercase;">
                  Total Paid
                </td>
                <td align="right" style="padding:14px 0;${D}font-size:28px;color:${OFFWHITE};letter-spacing:0.02em;">
                  ${rands(opts.totalCents)}
                </td>
              </tr>
            </table>
            <p style="margin:14px 0 0 0;font-family:${BODY};font-size:11px;font-weight:700;color:${OFFWHITE};opacity:0.7;letter-spacing:0.06em;text-transform:uppercase;">
              Questions? Just reply to this email &mdash; we&rsquo;ve got you.
            </p>
          </td>
        </tr>

        <!-- Ink footer -->
        <tr>
          <td style="background:${INK};color:${BONE};padding:26px 28px;text-align:center;border-top:1px solid ${LINE};">
            <p style="margin:0;${D}font-size:26px;color:${BONE};letter-spacing:0.03em;text-transform:uppercase;line-height:1;">
              ${BOLT}&nbsp;PREACHERS&nbsp;${BOLT}
            </p>
            <p style="margin:14px 0 0;font-family:${BODY};font-size:12px;font-style:italic;line-height:1.6;color:${BONE};opacity:0.9;max-width:420px;margin-left:auto;margin-right:auto;">
              ${escapeHtml(PREACHERS_VISION)}
            </p>
            <p style="margin:14px 0 0 0;font-family:${BODY};font-size:10px;font-weight:700;color:${BONE};letter-spacing:0.2em;text-transform:uppercase;opacity:0.7;">
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
      <td style="background:${NAVY};padding:10px 12px;border-top:1px solid ${LINE};">
        <span style="font-family:${BODY};font-size:10px;font-weight:700;color:${BONE};letter-spacing:0.18em;text-transform:uppercase;display:block;opacity:0.7;">${escapeHtml(k)}</span>
        <span style="font-family:${BODY};font-size:13px;color:${OFFWHITE};letter-spacing:0.02em;display:block;margin-top:3px;">${escapeHtml(v)}</span>
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
