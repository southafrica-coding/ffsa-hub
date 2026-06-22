/**
 * Branded HTML email for an event ticketing-analytics digest.
 * Composes the body and wraps it in the shared FFSA email shell so it
 * matches every other transactional send.
 */

import {
  renderEmailShell,
  bodyParagraph,
  emphasis,
  escapeHtml,
  EMAIL_COLORS as C,
} from "@/lib/email/shell";
import type { EventTicketReport } from "./event-ticket-report";
import {
  formatZar,
  cadenceAdjective,
  windowLabel,
  deltaText,
  capacityText,
  attendanceText,
} from "./format";

function siteBase(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://ffsahub.com";
  return raw.replace(/\/$/, "");
}

/** A two-column "label / value" row inside the stat table. */
function statRow(label: string, value: string, accent = false): string {
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${C.BORDER};font-size:13px;color:${C.TEXT_DIM};">${escapeHtml(label)}</td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid ${C.BORDER};font-size:15px;font-weight:700;color:${accent ? C.YELLOW : C.TEXT};font-family:Arial,sans-serif;">${escapeHtml(value)}</td>
    </tr>`;
}

export function renderEventReportEmail(report: EventTicketReport): {
  subject: string;
  html: string;
} {
  const adj = cadenceAdjective(report.cadence);
  const win = windowLabel(report);
  const delta = deltaText(report);

  const statTable = `
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 8px;border-collapse:collapse;">
    ${statRow("Tickets sold", String(report.ticketsSold), true)}
    ${statRow("Orders", String(report.ordersCount))}
    ${statRow("Gross revenue", formatZar(report.grossRevenueCents))}
    ${report.refundsCents > 0 ? statRow("Refunds", `− ${formatZar(report.refundsCents)}`) : ""}
    ${statRow("Net revenue", formatZar(report.netRevenueCents), true)}
    ${statRow("Capacity", capacityText(report))}
    ${statRow("Attendance", attendanceText(report))}
  </table>`;

  const topTiersHtml =
    report.topTiers.length > 0
      ? `
  <p style="margin:18px 0 8px;font-size:11px;letter-spacing:0.2em;font-weight:700;color:${C.YELLOW};text-transform:uppercase;">Top tiers this ${report.cadence === "weekly" ? "week" : "day"}</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    ${report.topTiers
      .map(
        (t) => `
    <tr>
      <td style="padding:7px 0;border-bottom:1px solid ${C.BORDER};font-size:13px;color:${C.TEXT_DIM};">${escapeHtml(t.name)}</td>
      <td align="right" style="padding:7px 0;border-bottom:1px solid ${C.BORDER};font-size:13px;color:${C.TEXT};font-family:Arial,sans-serif;">${t.tickets} · ${escapeHtml(formatZar(t.revenueCents))}</td>
    </tr>`
      )
      .join("")}
  </table>`
      : "";

  const intro =
    report.ticketsSold === 0
      ? bodyParagraph(
          `No tickets were sold in the last ${report.cadence === "weekly" ? "week" : "day"}. Here's where ${emphasis(escapeHtml(report.eventTitle))} stands.`
        )
      : bodyParagraph(
          `${emphasis(`${report.ticketsSold} ticket${report.ticketsSold === 1 ? "" : "s"}`)} sold for ${emphasis(escapeHtml(report.eventTitle))} over ${escapeHtml(win)}.`
        );

  const deltaHtml = delta
    ? `<p style="margin:2px 0 14px;font-size:13px;color:${C.TEXT_DIMMER};">${escapeHtml(delta)}</p>`
    : "";

  const bodyHtml = `${intro}${deltaHtml}${statTable}${topTiersHtml}`;

  const html = renderEmailShell({
    eyebrow: `${adj} ticketing report`,
    heading: escapeHtml(report.eventTitle),
    preheader: `${report.ticketsSold} sold · ${formatZar(report.netRevenueCents)} net · ${win}`,
    bodyHtml,
    cta: {
      label: "Open event",
      url: `${siteBase()}/events/${report.eventId}?tab=orders`,
    },
  });

  const subject = `${adj} ticketing report — ${report.eventTitle} (${report.ticketsSold} sold)`;
  return { subject, html };
}
