import { eventLogoBlock } from "../event-sender";
import { formatMoney } from "@/lib/currencies";
// FFSA Hub — Ticket confirmation email for THE SEND South Africa
// Conference.
//
// Same shape as the generic ticket-confirmation template (inline-CSS,
// table-based, QR codes loaded from /api/tickets/<code>/qr) but
// re-skinned to match the bespoke storefront aesthetic — cream paper
// base, navy header, gold/red/blue accents, Arial Black logo lockup.
//
// Email-safe choices:
//   - Only system fonts (Arial Black, Helvetica, Courier New) — Anton
//     and Bebas Neue used on the web don't load in Gmail/Outlook.
//   - No CSS classes (clients strip <style>); everything inline.
//   - Single 600px-wide table; nested tables for ticket stubs.

const GOLD = "#FACF50";
const CREAM = "#F7F1E8";
const RED = "#FA0015";
const BLUE = "#1535C6";
const NAVY = "#1C314C";
const INK = "#0E1A2B";

const DISPLAY =
  "'Arial Black','Helvetica Neue',Arial,sans-serif";
const BODY = "Helvetica,Arial,sans-serif";
const MONO = "'Courier New',Courier,monospace";

const STUB_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: GOLD, fg: NAVY },
  { bg: BLUE, fg: CREAM },
  { bg: RED, fg: CREAM },
  { bg: NAVY, fg: GOLD },
];

export function theSendTicketEmailHtml(opts: {
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
  const base = opts.siteUrl.replace(/\/$/, "");
  const money = (cents: number) => formatMoney(cents, opts.currency);
  const count = opts.tickets.length;
  const passWord = count === 1 ? "pass is" : "passes are";
  const qrWord = count === 1 ? "code" : "codes";
  const venueLine =
    opts.eventLocation || "Durban Christian Centre";

  const ticketsHtml = opts.tickets
    .map((t, i) => {
      const palette = STUB_PALETTE[i % STUB_PALETTE.length];
      const serial = String(i + 1).padStart(3, "0");
      return `
      <tr>
        <td style="padding:0;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;border:3px solid ${NAVY};background:${CREAM};">
            <tr>
              <!-- Coloured stub: ADMIT ONE + serial -->
              <td valign="middle" align="center" width="68" style="background:${palette.bg};color:${palette.fg};padding:18px 0;border-right:3px dashed ${NAVY};">
                <p style="margin:0;font-family:${DISPLAY};font-size:13px;font-weight:900;letter-spacing:0.16em;line-height:1.1;text-transform:uppercase;">ADMIT</p>
                <p style="margin:2px 0 0 0;font-family:${DISPLAY};font-size:13px;font-weight:900;letter-spacing:0.16em;line-height:1.1;text-transform:uppercase;">ONE</p>
                <p style="margin:10px 0 0 0;font-family:${MONO};font-size:10px;letter-spacing:0.12em;opacity:0.85;">${serial}</p>
              </td>
              <!-- Ticket body: name + QR + code -->
              <td style="padding:20px 22px;background:${CREAM};color:${NAVY};">
                <p style="margin:0 0 4px 0;font-family:${MONO};font-size:10px;color:${BLUE};letter-spacing:0.18em;text-transform:uppercase;font-weight:700;">// PASS ${i + 1} of ${count}</p>
                <h2 style="margin:0;font-family:${DISPLAY};font-size:24px;line-height:1.05;font-weight:900;color:${NAVY};letter-spacing:-0.005em;text-transform:uppercase;">${escapeHtml(t.tierName)}</h2>
                <div style="text-align:center;margin:18px 0 6px 0;">
                  <img
                    src="${base}/api/tickets/${encodeURIComponent(t.code)}/qr"
                    alt="QR code for pass ${i + 1}"
                    width="220"
                    height="220"
                    style="display:inline-block;background:#ffffff;padding:10px;border:2px solid ${NAVY};width:220px;height:220px;"
                  />
                </div>
                <p style="margin:8px 0 0 0;font-family:${MONO};font-size:12px;color:${NAVY};letter-spacing:0.06em;text-align:center;">CODE: ${escapeHtml(t.code)}</p>
                <div style="margin:14px 0 0 0;border-top:1px dashed ${NAVY};padding-top:10px;">
                  <p style="margin:0;font-family:${MONO};font-size:10px;letter-spacing:0.1em;color:${NAVY};text-transform:uppercase;text-align:center;">→ ADMIT ONE · ${escapeHtml(venueLine.toUpperCase())} · ${escapeHtml(opts.eventDate.toUpperCase())}</p>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr><td style="height:18px;line-height:18px;font-size:0;">&nbsp;</td></tr>`;
    })
    .join("");

  // Ticker row — one slogan + arrow, sized to fit a 600px email.
  // Multiple repeats with nowrap blew up the table width on some clients.
  const ticker = `<span style="color:${RED};">&rarr;</span>&nbsp;THE WAR ON INACTION HAS BEGUN&nbsp;<span style="color:${RED};">&rarr;</span>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Your tickets — ${escapeHtml(opts.eventTitle)}</title>
</head>
<body style="margin:0;padding:0;background:${INK};font-family:${BODY};color:${NAVY};">
  <!-- Preheader (hidden) — sets Gmail/iOS inbox preview text -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${INK};">
    You're in. THE SEND SOUTH AFRICA is locked. ${count} ${passWord} attached.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${INK};padding:30px 10px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:${CREAM};border:3px solid ${NAVY};table-layout:fixed;">
        ${opts.headerLogoUrl ? `<tr><td align="center" style="padding:22px 22px 0;">${eventLogoBlock(opts.headerLogoUrl, opts.eventTitle)}</td></tr>` : ""}

        <!-- Yellow ticker bar -->
        <tr>
          <td style="background:${GOLD};border-bottom:3px solid ${NAVY};padding:8px 14px;font-family:${DISPLAY};font-size:13px;font-weight:900;color:${NAVY};letter-spacing:0.14em;text-transform:uppercase;line-height:1.2;overflow:hidden;white-space:nowrap;">
            ${ticker}
          </td>
        </tr>

        <!-- Navy masthead -->
        <tr>
          <td style="background:${NAVY};padding:14px 20px;border-bottom:3px solid ${GOLD};">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td valign="middle" style="font-family:${DISPLAY};font-size:22px;font-weight:900;color:${GOLD};letter-spacing:-0.01em;text-transform:uppercase;line-height:1;">
                  THE&nbsp;SEND&nbsp;<span style="font-family:${BODY};font-size:20px;color:${GOLD};">&#10140;</span>
                </td>
                <td valign="middle" align="right" style="font-family:${MONO};font-size:10px;color:${CREAM};letter-spacing:0.2em;text-transform:uppercase;">
                  SOUTH&nbsp;AFRICA / MMXXVI
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Hero -->
        <tr>
          <td style="background:${NAVY};color:${CREAM};padding:36px 28px 32px 28px;">
            <p style="margin:0;font-family:${MONO};font-size:11px;color:${GOLD};letter-spacing:0.2em;text-transform:uppercase;">
              &ldquo;Pass Confirmed&rdquo;&nbsp;&nbsp;${escapeHtml(opts.eventDate)}
            </p>
            <h1 style="margin:14px 0 0 0;font-family:${DISPLAY};font-size:52px;line-height:0.92;color:${CREAM};font-weight:900;letter-spacing:0.005em;text-transform:uppercase;">
              YOU&rsquo;RE
            </h1>
            <h1 style="margin:2px 0 0 0;font-family:${DISPLAY};font-size:72px;line-height:0.92;color:${GOLD};font-weight:900;letter-spacing:0.005em;text-transform:uppercase;">
              IN.<span style="color:${RED};font-family:${BODY};font-weight:700;font-size:40px;vertical-align:middle;margin-left:8px;">&#10140;</span>
            </h1>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;">
              <tr>
                <td style="background:${RED};color:${CREAM};padding:8px 14px;font-family:${DISPLAY};font-size:15px;font-weight:900;letter-spacing:0.1em;text-transform:uppercase;">
                  <span style="color:${GOLD};">&rarr;</span>&nbsp;The War on Inaction Has Begun
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Mono coordinates: DATES / VENUE / DOORS -->
        <tr>
          <td style="background:${NAVY};padding:0 28px 28px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid rgba(247,241,232,0.18);border-collapse:collapse;">
              ${row("// DATES", opts.eventDate)}
              ${row("// VENUE", venueLine)}
              ${row("// ORDER", `#${opts.orderId.slice(0, 8).toUpperCase()}`)}
            </table>
          </td>
        </tr>

        <!-- Intro on cream paper -->
        <tr>
          <td style="background:${CREAM};color:${NAVY};padding:30px 28px 8px 28px;">
            <p style="margin:0;font-family:${MONO};font-size:11px;color:${BLUE};letter-spacing:0.2em;font-weight:700;text-transform:uppercase;">// Briefing &mdash; 01</p>
            <h2 style="margin:10px 0 0 0;font-family:${DISPLAY};font-size:26px;line-height:1.1;color:${NAVY};font-weight:900;letter-spacing:0.005em;text-transform:uppercase;">
              Hi ${escapeHtml(opts.buyerFirstName)} &mdash; your ${count} ${passWord} confirmed.
            </h2>
            <p style="margin:14px 0 0 0;font-family:${BODY};font-size:14px;line-height:1.65;color:${NAVY};">
              Show the QR ${qrWord} below at the door. Screenshot, print, or pull this email up live &mdash; all work. Save this email; it&rsquo;s your entry.
            </p>
          </td>
        </tr>

        <tr><td style="background:${CREAM};height:24px;line-height:24px;font-size:0;">&nbsp;</td></tr>

        <!-- Tickets -->
        <tr>
          <td style="background:${CREAM};padding:0 28px;">
            <p style="margin:0 0 14px 0;font-family:${MONO};font-size:11px;color:${BLUE};letter-spacing:0.2em;font-weight:700;text-transform:uppercase;">// Your Passes &mdash; 02</p>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              ${ticketsHtml}
            </table>
          </td>
        </tr>

        <!-- Order summary on cream -->
        <tr>
          <td style="background:${CREAM};padding:0 28px 28px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-top:3px solid ${NAVY};border-bottom:3px solid ${NAVY};">
              <tr>
                <td style="padding:14px 0;font-family:${DISPLAY};font-size:13px;font-weight:900;color:${NAVY};letter-spacing:0.14em;text-transform:uppercase;">
                  Total Paid
                </td>
                <td align="right" style="padding:14px 0;font-family:${DISPLAY};font-size:24px;font-weight:900;color:${BLUE};letter-spacing:0.005em;">
                  ${money(opts.totalCents)}
                </td>
              </tr>
            </table>
            <p style="margin:14px 0 0 0;font-family:${MONO};font-size:10px;color:${NAVY};opacity:0.7;letter-spacing:0.08em;text-transform:uppercase;">
              &rarr; Questions? Reply to this email and we&rsquo;ll sort you out.
            </p>
          </td>
        </tr>

        <!-- Navy footer -->
        <tr>
          <td style="background:${NAVY};color:${CREAM};padding:26px 28px;text-align:center;">
            <p style="margin:0;font-family:${DISPLAY};font-size:24px;font-weight:900;color:${GOLD};letter-spacing:-0.01em;text-transform:uppercase;line-height:1;">
              THE&nbsp;SEND&nbsp;<span style="font-family:${BODY};font-size:22px;">&#10140;</span>
            </p>
            <p style="margin:14px 0 10px 0;">
              <img
                src="${base}/brand/ff-wordmark-white@email.png"
                alt="Fire &amp; Fragrance"
                width="150"
                height="18"
                style="display:inline-block;width:150px;height:auto;opacity:0.85;"
              />
            </p>
            <p style="margin:0;font-family:${MONO};font-size:10px;color:${CREAM};letter-spacing:0.2em;text-transform:uppercase;opacity:0.85;">
              ${escapeHtml(opts.eventTitle.toUpperCase())} &middot; Powered by FFSA Hub &middot; &copy;&nbsp;MMXXVI
            </p>
            <p style="margin:8px 0 0 0;font-family:${MONO};font-size:9px;color:${GOLD};letter-spacing:0.24em;text-transform:uppercase;opacity:0.7;">
              For External Use &mdash; Distribute Freely
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// One coordinate row inside the hero's data block. Used so each row
// matches the storefront's // KEY  Value cadence.
function row(k: string, v: string): string {
  return `
    <tr>
      <td style="background:${NAVY};padding:10px 12px;border-top:1px solid rgba(247,241,232,0.18);">
        <span style="font-family:${MONO};font-size:10px;color:${GOLD};letter-spacing:0.18em;text-transform:uppercase;display:block;">${escapeHtml(k)}</span>
        <span style="font-family:${MONO};font-size:13px;color:${CREAM};letter-spacing:0.02em;display:block;margin-top:3px;">${escapeHtml(v)}</span>
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
