import { formatMoney } from "@/lib/currencies";
// FFSA Hub — Refund confirmation email (transactional).
//
// Sent when staff refund an order, in full or in part. Deliberately
// shares the ticket-confirmation design language (same dark card,
// same wordmark, same footer) so it reads as the follow-up to the
// email the buyer already has, not a stray notice from elsewhere.
//
// One template across all four event brands: a refund is an account
// matter rather than a brand moment, and the From: identity already
// carries the brand (see sendRefundEmail).

const BG = "#0d0b08"; // page background (≈ --surface-1)
const CARD = "#15120e"; // card background (≈ --surface-2)
const INSET = "#1a1611"; // amount-row inset (≈ --surface-3)
const BORDER = "#2a241d"; // borders (≈ --surface-4)
const TEXT = "#f0ebe3"; // body text (≈ --text-primary)
const TEXT_DIM = "#a89b8a"; // secondary text
const TEXT_DIMMER = "#6e6356"; // tertiary text
const YELLOW = "#fbbf24"; // brand yellow (≈ --yellow)

export function refundConfirmationEmailHtml(opts: {
  buyerFirstName: string;
  eventTitle: string;
  orderId: string;
  /** Amount refunded by THIS refund, in cents. */
  refundedCents: number;
  /** Cumulative refunded total, in cents — differs on a second partial. */
  totalRefundedCents: number;
  orderTotalCents: number;
  /** False when only part of the order was refunded. */
  isFullRefund: boolean;
  siteUrl: string;
  /** ISO 4217 code from orders.currency. */
  currency: string;
  /** Buyer-facing note, e.g. why the event was cancelled. */
  cancellationMessage?: string | null;
}): string {
  const money = (cents: number) => formatMoney(cents, opts.currency);
  const base = opts.siteUrl.replace(/\/$/, "");
  const note = opts.cancellationMessage?.trim() || null;

  // A partial refund leaves the buyer holding valid tickets — saying
  // "your tickets have been cancelled" there would be wrong.
  const ticketLine = opts.isFullRefund
    ? "Your tickets for this order have been cancelled and will no longer scan at the door."
    : "This was a partial refund — the tickets on this order are still valid and will scan at the door as normal.";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Refund for ${escapeHtml(opts.eventTitle)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:Helvetica,Arial,sans-serif;color:${TEXT};">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${BG};padding:36px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;background:${CARD};border:1px solid ${BORDER};border-radius:14px;overflow:hidden;">

        <!-- Top accent strip — brand yellow -->
        <tr>
          <td style="height:5px;background:${YELLOW};line-height:5px;font-size:0;">&nbsp;</td>
        </tr>

        <!-- Header (logo intentionally omitted) -->
        <tr>
          <td style="padding:26px 32px 8px 32px;">
            <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:700;color:${YELLOW};letter-spacing:0.3em;text-transform:uppercase;">${opts.isFullRefund ? "Refund Processed" : "Partial Refund"}</p>
            <h1 style="margin:10px 0 0 0;font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:32px;line-height:1.05;color:${TEXT};font-weight:900;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(opts.eventTitle)}</h1>
          </td>
        </tr>

        <!-- Intro -->
        <tr>
          <td style="padding:18px 32px 0 32px;">
            <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${TEXT};line-height:1.6;">Hi ${escapeHtml(opts.buyerFirstName)}, we've refunded your order. ${escapeHtml(ticketLine)}</p>
          </td>
        </tr>

        ${
          note
            ? `<!-- Organiser note (e.g. why the event was cancelled) -->
        <tr>
          <td style="padding:16px 32px 0 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="padding:16px 18px;border:1px solid ${BORDER};border-left:3px solid ${YELLOW};border-radius:10px;background:${INSET};">
                  <p style="margin:0 0 6px 0;font-family:Helvetica,Arial,sans-serif;font-size:10px;color:${YELLOW};letter-spacing:0.22em;text-transform:uppercase;font-weight:700;">A note from the organisers</p>
                  <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${TEXT};line-height:1.6;white-space:pre-wrap;">${escapeHtml(note)}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>`
            : ""
        }

        <tr><td style="height:22px;line-height:22px;font-size:0;">&nbsp;</td></tr>

        <!-- Amount -->
        <tr>
          <td style="padding:0 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="padding:24px 18px;border:1px solid ${BORDER};border-radius:12px;background:${INSET};text-align:center;">
                  <p style="margin:0 0 8px 0;font-family:Helvetica,Arial,sans-serif;font-size:10px;color:${YELLOW};letter-spacing:0.22em;text-transform:uppercase;font-weight:700;">Amount Refunded</p>
                  <p style="margin:0;font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:34px;font-weight:900;color:${TEXT};letter-spacing:0.02em;">${money(opts.refundedCents)}</p>
                  ${
                    opts.isFullRefund
                      ? ""
                      : `<p style="margin:10px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${TEXT_DIM};">${money(opts.totalRefundedCents)} of ${money(opts.orderTotalCents)} refunded in total</p>`
                  }
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr><td style="height:20px;line-height:20px;font-size:0;">&nbsp;</td></tr>

        <!-- Timing note -->
        <tr>
          <td style="padding:0 32px;">
            <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${TEXT_DIM};line-height:1.6;">Refunds are returned to the card or account you paid from. Depending on your bank this usually reflects within 5–10 working days.</p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:12px 32px 30px 32px;border-top:1px solid ${BORDER};">
            <p style="margin:16px 0 4px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${TEXT_DIM};letter-spacing:0.04em;">Order #${escapeHtml(opts.orderId.slice(0, 8))} · Order total ${money(opts.orderTotalCents)}</p>
            <p style="margin:8px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${TEXT_DIMMER};">Something not right? Reply to this email.</p>
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
