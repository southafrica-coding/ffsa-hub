/**
 * Daily ticket-sales report builder.
 *
 * Queries yesterday's paid orders + their tickets and produces a
 * Slack-ready summary block. Posted by /api/cron/daily-ticket-report
 * to the channel configured in SLACK_TICKETS_REPORT_CHANNEL_ID (or
 * SLACK_ACTIVITY_CHANNEL_ID as a fallback).
 *
 * "Sold" = orders with status='paid' whose paid_at lands in the
 * UTC calendar day that just ended. Partially-refunded orders are
 * intentionally excluded in v1; refunds are reported separately
 * once we add a Tier-2 weekly digest.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { BASE_CURRENCY, formatMoney } from "@/lib/currencies";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

type OrderRow = {
  id: string;
  total_cents: number;
  currency: string | null;
  event_id: string;
  events: { title: string | null } | null;
  tickets: Array<{ id: string }> | null;
};

type EventAggregate = {
  eventId: string;
  title: string;
  tickets: number;
  revenueCents: number;
  /** An event sells in exactly one currency, so this labels the row. */
  currency: string;
};

export type DailyTicketReport = {
  windowStart: string; // ISO
  windowEnd: string;   // ISO
  tickets: number;
  ordersCount: number;
  /**
   * Revenue in the base currency (ZAR) only. Events can now sell in
   * other currencies, and adding dissimilar amounts together would be
   * meaningless — see revenueByCurrency for the full picture.
   */
  revenueCents: number;
  /** Revenue keyed by ISO 4217 code, e.g. { ZAR: 125000, USD: 4500 }. */
  revenueByCurrency: Record<string, number>;
  topEvents: EventAggregate[];
  comparison: {
    previousTickets: number;
    deltaPct: number | null; // null if previous was 0 (no meaningful %)
  };
};

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

/**
 * Build a structured daily ticket report for the UTC calendar day
 * that ended most recently (yesterday relative to now).
 */
export async function buildDailyTicketReport(
  now: Date = new Date()
): Promise<DailyTicketReport> {
  const admin = createAdminClient();
  const { yesterdayStart, todayStart, dayBeforeStart } = computeWindow(now);

  // Yesterday's paid orders, joined to event title + tickets
  const { data: ordersRaw, error: ordersErr } = await admin
    .from("orders")
    .select("id, total_cents, currency, event_id, events(title), tickets(id)")
    .eq("status", "paid")
    .gte("paid_at", yesterdayStart.toISOString())
    .lt("paid_at", todayStart.toISOString());

  if (ordersErr) {
    throw new Error(`orders query failed: ${ordersErr.message}`);
  }

  const orders = (ordersRaw ?? []) as OrderRow[];
  const tickets = orders.reduce(
    (sum, o) => sum + (o.tickets?.length ?? 0),
    0
  );
  const revenueByCurrency: Record<string, number> = {};
  for (const o of orders) {
    const code = o.currency ?? BASE_CURRENCY;
    revenueByCurrency[code] = (revenueByCurrency[code] ?? 0) + (o.total_cents ?? 0);
  }
  const revenueCents = revenueByCurrency[BASE_CURRENCY] ?? 0;

  // Group by event for the top-N section
  const byEvent = new Map<string, EventAggregate>();
  for (const o of orders) {
    const existing = byEvent.get(o.event_id) ?? {
      eventId: o.event_id,
      title: o.events?.title ?? "(untitled event)",
      tickets: 0,
      revenueCents: 0,
      currency: o.currency ?? BASE_CURRENCY,
    };
    existing.tickets += o.tickets?.length ?? 0;
    existing.revenueCents += o.total_cents ?? 0;
    byEvent.set(o.event_id, existing);
  }
  const topEvents = Array.from(byEvent.values())
    .sort((a, b) => b.tickets - a.tickets || b.revenueCents - a.revenueCents)
    .slice(0, 5);

  // Previous day's tickets for delta context
  const previousTickets = await countTicketsInWindow(
    admin,
    dayBeforeStart,
    yesterdayStart
  );
  const deltaPct =
    previousTickets > 0
      ? Math.round(((tickets - previousTickets) / previousTickets) * 1000) / 10
      : null;

  return {
    windowStart: yesterdayStart.toISOString(),
    windowEnd: todayStart.toISOString(),
    tickets,
    ordersCount: orders.length,
    revenueCents,
    revenueByCurrency,
    topEvents,
    comparison: { previousTickets, deltaPct },
  };
}

/**
 * Render the report as a Slack Block Kit payload + plain-text
 * fallback. Returned shape is what slack.postMessage expects.
 */
export function renderDailyTicketReportMessage(
  report: DailyTicketReport
): { text: string; blocks: unknown[] } {
  const dayLabel = friendlyDate(new Date(report.windowStart));
  const headline =
    report.tickets === 0
      ? `:zzz: No tickets sold on ${dayLabel}`
      : `:tickets: ${report.tickets} ticket${report.tickets === 1 ? "" : "s"} sold on ${dayLabel}`;

  const summaryLines: string[] = [
    `*${headline}*`,
    "",
    `*Revenue:* ${formatRevenue(report.revenueByCurrency)}`,
    `*Orders:* ${report.ordersCount}`,
    formatDeltaLine(report.tickets, report.comparison),
  ].filter(Boolean) as string[];

  const blocks: unknown[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: summaryLines.join("\n") },
    },
  ];

  if (report.topEvents.length > 0) {
    const topLines = report.topEvents.map(
      (e, i) =>
        `${i + 1}. *${escapeMrkdwn(e.title)}* — ${e.tickets} ticket${e.tickets === 1 ? "" : "s"} (${formatMoney(e.revenueCents, e.currency)})`
    );
    blocks.push(
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: ["*Top events*", "", ...topLines].join("\n"),
        },
      }
    );
  }

  return {
    text: stripMrkdwn(headline),
    blocks,
  };
}

// ────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────

function computeWindow(now: Date): {
  yesterdayStart: Date;
  todayStart: Date;
  dayBeforeStart: Date;
} {
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  );
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
  const dayBeforeStart = new Date(yesterdayStart);
  dayBeforeStart.setUTCDate(dayBeforeStart.getUTCDate() - 1);
  return { yesterdayStart, todayStart, dayBeforeStart };
}

async function countTicketsInWindow(
  admin: AdminClient,
  start: Date,
  end: Date
): Promise<number> {
  const { data, error } = await admin
    .from("orders")
    .select("tickets(id)")
    .eq("status", "paid")
    .gte("paid_at", start.toISOString())
    .lt("paid_at", end.toISOString());
  if (error) {
    console.error("[daily-ticket-report] previous-window query failed", error);
    return 0;
  }
  const rows = (data ?? []) as Array<{ tickets: Array<{ id: string }> | null }>;
  return rows.reduce((sum, r) => sum + (r.tickets?.length ?? 0), 0);
}

function friendlyDate(d: Date): string {
  // "Mon 30 May" — calendar day labelling for SAST readers; using
  // toLocaleDateString in en-GB gives day-month order which matches
  // how the team writes dates.
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// Events can sell in different currencies, so the day's revenue is a
// set of per-currency totals rather than one number. Joined with " + "
// so a mixed day reads "R12 500,00 + $450.00".
function formatRevenue(byCurrency: Record<string, number>): string {
  const entries = Object.entries(byCurrency).filter(([, cents]) => cents !== 0);
  if (entries.length === 0) return formatMoney(0, BASE_CURRENCY);
  return entries
    .sort(([a], [b]) => (a === BASE_CURRENCY ? -1 : b === BASE_CURRENCY ? 1 : a.localeCompare(b)))
    .map(([code, cents]) => formatMoney(cents, code))
    .join(" + ");
}

function formatDeltaLine(
  todayTickets: number,
  comparison: DailyTicketReport["comparison"]
): string | null {
  if (comparison.deltaPct === null) {
    return comparison.previousTickets === 0 && todayTickets === 0
      ? null
      : `*Previous day:* ${comparison.previousTickets} ticket${comparison.previousTickets === 1 ? "" : "s"}`;
  }
  const arrow =
    comparison.deltaPct > 0
      ? ":arrow_upper_right:"
      : comparison.deltaPct < 0
        ? ":arrow_lower_right:"
        : ":arrow_right:";
  const sign = comparison.deltaPct > 0 ? "+" : "";
  return `*Vs previous day:* ${arrow} ${sign}${comparison.deltaPct}% (was ${comparison.previousTickets})`;
}

function escapeMrkdwn(s: string): string {
  // Slack mrkdwn doesn't have a formal escape, but the worst
  // offenders are < > & inside generic text. Best-effort here.
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stripMrkdwn(s: string): string {
  return s.replace(/[*_`]/g, "");
}
