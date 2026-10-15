import { eventLogoBlock } from "../event-sender";
// FFSA Hub — Event cancellation notice (transactional).
//
// Sent to ticket holders when an event is cancelled, to explain WHY —
// the refund email tells them their money is coming back, this tells
// them the reason. Deliberately shares the refund email's design
// language (same dark card, wordmark, yellow accent) so it reads as
// part of the same conversation from the organisers.

const BG = "#0d0b08"; // page background (≈ --surface-1)
const CARD = "#15120e"; // card background (≈ --surface-2)
const INSET = "#1a1611"; // message inset (≈ --surface-3)
const BORDER = "#2a241d"; // borders (≈ --surface-4)
const TEXT = "#f0ebe3"; // body text (≈ --text-primary)
const TEXT_DIM = "#a89b8a"; // secondary text
const TEXT_DIMMER = "#6e6356"; // tertiary text
const YELLOW = "#fbbf24"; // brand yellow (≈ --yellow)

export function eventCancellationNoticeEmailHtml(opts: {
  eventTitle: string;
  /** The organiser's cancellation message — rendered verbatim. */
  message: string;
  /** Reassurance line about the refund. Omit to hide. */
  refundLine?: string | null;
  siteUrl: string;
  /** The event's own logo, shown first when it asked for one (migration 241). */
  headerLogoUrl?: string | null;
}): string {
  const base = opts.siteUrl.replace(/\/$/, "");

  // Preserve the organiser's paragraph breaks: split on blank lines into
  // paragraphs, keep single newlines within a paragraph as <br>.
  const paragraphs = opts.message
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 14px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:${TEXT};line-height:1.65;">${escapeHtml(
          p
        ).replace(/\n/g, "<br>")}</p>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(opts.eventTitle)} — cancelled</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:Helvetica,Arial,sans-serif;color:${TEXT};">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${BG};padding:36px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;background:${CARD};border:1px solid ${BORDER};border-radius:14px;overflow:hidden;">

        <!-- Top accent strip — brand yellow -->
        <tr>
          <td style="height:5px;background:${YELLOW};line-height:5px;font-size:0;">&nbsp;</td>
        </tr>

        ${opts.headerLogoUrl ? `<tr><td align="center" style="padding:26px 32px 0;">${eventLogoBlock(opts.headerLogoUrl, opts.eventTitle)}</td></tr>` : ""}
        <!-- Header (the event's own logo above, when it has asked for one) -->
        <tr>
          <td style="padding:26px 32px 8px 32px;">
            <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:700;color:${YELLOW};letter-spacing:0.3em;text-transform:uppercase;">Event Cancelled</p>
            <h1 style="margin:10px 0 0 0;font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:30px;line-height:1.05;color:${TEXT};font-weight:900;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(opts.eventTitle)}</h1>
          </td>
        </tr>

        <!-- Message -->
        <tr>
          <td style="padding:20px 32px 0 32px;">
            ${paragraphs}
          </td>
        </tr>

        ${
          opts.refundLine
            ? `<!-- Refund reassurance -->
        <tr>
          <td style="padding:8px 32px 0 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="padding:16px 18px;border:1px solid ${BORDER};border-left:3px solid ${YELLOW};border-radius:10px;background:${INSET};">
                  <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${TEXT_DIM};line-height:1.6;">${escapeHtml(opts.refundLine)}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>`
            : ""
        }

        <tr><td style="height:26px;line-height:26px;font-size:0;">&nbsp;</td></tr>

        <!-- Footer -->
        <tr>
          <td style="padding:12px 32px 30px 32px;border-top:1px solid ${BORDER};">
            <p style="margin:16px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${TEXT_DIMMER};">Questions? Just reply to this email.</p>
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
