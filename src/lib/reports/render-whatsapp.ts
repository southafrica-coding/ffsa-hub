/**
 * WhatsApp rendering for an event ticketing-analytics digest.
 *
 * Business-initiated WhatsApp messages (sent outside the 24-hour
 * customer-service window) MUST use a pre-approved Content template,
 * so this renderer returns the ordered template variables rather than
 * free-form text. The variable order below must match the approved
 * template referenced by TWILIO_WA_REPORT_CONTENT_SID:
 *
 *   FFSA ticketing — {{1}}
 *   {{2}}
 *   Sold {{3}}  ·  Orders {{4}}
 *   Net {{5}}  ({{6}} refunded)
 *   Checked in {{7}}  ·  Remaining {{8}}
 *
 * fallbackText is a plain-text equivalent for the Twilio WhatsApp
 * sandbox (which accepts free-form Body during testing) and for logs.
 */

import type { EventTicketReport } from "./event-ticket-report";
import {
  formatZar,
  windowLabel,
  attendanceText,
} from "./format";

export function renderEventReportWhatsApp(report: EventTicketReport): {
  contentVariables: Record<string, string>;
  fallbackText: string;
} {
  const win = windowLabel(report);
  const remaining =
    report.capacityTotal == null
      ? "uncapped"
      : `${report.capacityRemaining} left`;

  const contentVariables: Record<string, string> = {
    "1": report.eventTitle,
    "2": win,
    "3": String(report.ticketsSold),
    "4": String(report.ordersCount),
    "5": formatZar(report.netRevenueCents),
    "6": formatZar(report.refundsCents),
    "7": `${report.checkedIn}/${report.totalIssued}`,
    "8": remaining,
  };

  const fallbackText = [
    `*FFSA ticketing — ${report.eventTitle}*`,
    win,
    `Sold ${report.ticketsSold}  ·  Orders ${report.ordersCount}`,
    `Net ${formatZar(report.netRevenueCents)}` +
      (report.refundsCents > 0
        ? `  (${formatZar(report.refundsCents)} refunded)`
        : ""),
    attendanceText(report),
  ].join("\n");

  return { contentVariables, fallbackText };
}
