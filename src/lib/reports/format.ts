/**
 * Shared formatting helpers for event-report digests (email + WhatsApp).
 * Kept channel-agnostic so both renderers render identical figures.
 */

import type { EventTicketReport, ReportCadence } from "./event-ticket-report";

/** ZAR formatting consistent with the Slack daily report ("R1,234.56"). */
export function formatZar(cents: number): string {
  return `R${(cents / 100).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function cadenceNoun(cadence: ReportCadence): string {
  return cadence === "weekly" ? "week" : "day";
}

export function cadenceAdjective(cadence: ReportCadence): string {
  return cadence === "weekly" ? "Weekly" : "Daily";
}

function utcDayLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Human label for the report window. The stored windowEnd is the
 * exclusive UTC midnight after the last included day, so the last
 * included day is windowEnd − 1.
 *   • daily  → "Mon 22 Jun"
 *   • weekly → "Mon 16 Jun – Sun 22 Jun"
 */
export function windowLabel(report: EventTicketReport): string {
  const start = new Date(report.windowStart);
  const lastDay = new Date(report.windowEnd);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  if (report.cadence === "daily") return utcDayLabel(start);
  return `${utcDayLabel(start)} – ${utcDayLabel(lastDay)}`;
}

/** Plain-text delta sentence, e.g. "+12% vs the previous week (was 40)". */
export function deltaText(report: EventTicketReport): string | null {
  const { previousTickets, deltaPct } = report.comparison;
  const noun = cadenceNoun(report.cadence);
  if (deltaPct === null) {
    if (previousTickets === 0 && report.ticketsSold === 0) return null;
    return `${previousTickets} sold the previous ${noun}`;
  }
  const sign = deltaPct > 0 ? "+" : "";
  const arrow = deltaPct > 0 ? "▲" : deltaPct < 0 ? "▼" : "→";
  return `${arrow} ${sign}${deltaPct}% vs the previous ${noun} (was ${previousTickets})`;
}

export function capacityText(report: EventTicketReport): string {
  if (report.capacityTotal == null) return `${report.capacitySold} sold (uncapped)`;
  return `${report.capacitySold} / ${report.capacityTotal} sold · ${report.capacityRemaining} left`;
}

export function attendanceText(report: EventTicketReport): string {
  if (report.totalIssued === 0) return "No tickets issued yet";
  return `${report.checkedIn} / ${report.totalIssued} checked in (${report.attendancePct}%)`;
}
