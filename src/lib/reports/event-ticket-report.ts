/**
 * Per-event ticketing-analytics report builder.
 *
 * Powers the recurring digests that event organisers subscribe to in
 * the event "Reports" tab (delivered by /api/cron/event-reports). It is
 * the per-event, configurable-window sibling of the org-wide Slack
 * report in src/lib/slack/daily-ticket-report.ts and reuses the same
 * "paid orders joined to their tickets" query shape.
 *
 * Window semantics (UTC calendar days, matching daily-ticket-report):
 *   • daily  → the single UTC day that just ended (yesterday).
 *   • weekly → the 7 UTC days that just ended.
 * The comparison block looks at the immediately preceding window of
 * equal length so a digest can say "+12% vs the previous week".
 *
 * "Sold" = orders.status='paid' whose paid_at lands in the window.
 * Refunds are windowed separately on refunded_at. Capacity and
 * attendance are standing (lifetime) figures, not window-bound —
 * they answer "where does this event stand right now".
 */

import { createAdminClient } from "@/lib/supabase/admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

export type ReportCadence = "daily" | "weekly";

type OrderRow = {
  id: string;
  total_cents: number;
  tickets: Array<{ id: string; ticket_type_id: string | null }> | null;
};

export type TierAggregate = {
  ticketTypeId: string | null;
  name: string;
  tickets: number;
  revenueCents: number;
};

export type EventTicketReport = {
  eventId: string;
  eventTitle: string;
  cadence: ReportCadence;
  windowStart: string; // ISO
  windowEnd: string; // ISO

  // Window-bound sales
  ticketsSold: number;
  ordersCount: number;
  grossRevenueCents: number;
  refundsCents: number;
  netRevenueCents: number;
  topTiers: TierAggregate[];

  // Standing (lifetime) context — not window-bound
  capacitySold: number;
  capacityTotal: number | null; // null = at least one tier is uncapped
  capacityRemaining: number | null;
  checkedIn: number;
  totalIssued: number;
  attendancePct: number;

  comparison: {
    previousTickets: number;
    deltaPct: number | null; // null if previous window had 0 tickets
  };
};

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

/**
 * Build the analytics report for a single event over the cadence
 * window ending at the most recent UTC midnight.
 */
export async function buildEventTicketReport(
  eventId: string,
  cadence: ReportCadence,
  now: Date = new Date()
): Promise<EventTicketReport> {
  const admin = createAdminClient();
  const { windowStart, windowEnd, prevStart, prevEnd } = computeWindow(
    cadence,
    now
  );

  const [{ data: eventRow }, ticketTypes, attendance] = await Promise.all([
    admin.from("events").select("title").eq("id", eventId).maybeSingle(),
    loadTicketTypes(admin, eventId),
    loadAttendance(admin, eventId),
  ]);

  // Window's paid orders + their tickets (mirrors daily-ticket-report).
  const { data: ordersRaw, error: ordersErr } = await admin
    .from("orders")
    .select("id, total_cents, tickets(id, ticket_type_id)")
    .eq("event_id", eventId)
    .eq("status", "paid")
    .gte("paid_at", windowStart.toISOString())
    .lt("paid_at", windowEnd.toISOString());

  if (ordersErr) {
    throw new Error(`orders query failed: ${ordersErr.message}`);
  }

  const orders = (ordersRaw ?? []) as OrderRow[];
  const ticketsSold = orders.reduce(
    (sum, o) => sum + (o.tickets?.length ?? 0),
    0
  );
  const grossRevenueCents = orders.reduce(
    (sum, o) => sum + (o.total_cents ?? 0),
    0
  );

  // Per-tier breakdown. A paid order's total_cents is attributed to its
  // tickets pro-rata so the tier revenue split stays sensible even when
  // an order spans multiple tiers (the common case is a single tier).
  const tierNames = new Map<string, string>(
    ticketTypes.map((t) => [t.id, t.name])
  );
  const byTier = new Map<string, TierAggregate>();
  for (const o of orders) {
    const lines = o.tickets ?? [];
    const perTicketCents = lines.length
      ? (o.total_cents ?? 0) / lines.length
      : 0;
    for (const line of lines) {
      const key = line.ticket_type_id ?? "__unknown__";
      const existing =
        byTier.get(key) ??
        ({
          ticketTypeId: line.ticket_type_id,
          name: tierNames.get(key) ?? "(removed tier)",
          tickets: 0,
          revenueCents: 0,
        } as TierAggregate);
      existing.tickets += 1;
      existing.revenueCents += perTicketCents;
      byTier.set(key, existing);
    }
  }
  const topTiers = Array.from(byTier.values())
    .map((t) => ({ ...t, revenueCents: Math.round(t.revenueCents) }))
    .sort((a, b) => b.tickets - a.tickets || b.revenueCents - a.revenueCents)
    .slice(0, 5);

  // Refunds windowed on refunded_at.
  const refundsCents = await sumRefundsInWindow(
    admin,
    eventId,
    windowStart,
    windowEnd
  );

  // Standing capacity figures.
  const capacitySold = ticketTypes.reduce(
    (sum, t) => sum + (t.quantity_sold ?? 0),
    0
  );
  const anyUncapped = ticketTypes.some((t) => t.capacity == null);
  const capacityTotal = anyUncapped
    ? null
    : ticketTypes.reduce((sum, t) => sum + (t.capacity ?? 0), 0);
  const capacityRemaining =
    capacityTotal == null ? null : Math.max(0, capacityTotal - capacitySold);

  // Standing attendance figures (exclude void tickets from the base).
  const totalIssued = attendance.valid + attendance.checkedIn;
  const attendancePct =
    totalIssued > 0
      ? Math.round((attendance.checkedIn / totalIssued) * 1000) / 10
      : 0;

  // Prior-window ticket count for the delta line.
  const previousTickets = await countTicketsInWindow(
    admin,
    eventId,
    prevStart,
    prevEnd
  );
  const deltaPct =
    previousTickets > 0
      ? Math.round(((ticketsSold - previousTickets) / previousTickets) * 1000) /
        10
      : null;

  return {
    eventId,
    eventTitle: eventRow?.title ?? "(untitled event)",
    cadence,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    ticketsSold,
    ordersCount: orders.length,
    grossRevenueCents,
    refundsCents,
    netRevenueCents: grossRevenueCents - refundsCents,
    topTiers,
    capacitySold,
    capacityTotal,
    capacityRemaining,
    checkedIn: attendance.checkedIn,
    totalIssued,
    attendancePct,
    comparison: { previousTickets, deltaPct },
  };
}

// ────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────

/**
 * Window boundaries for the cadence, anchored at the most recent UTC
 * midnight. daily = 1 day; weekly = 7 days. prev* is the immediately
 * preceding window of equal length.
 */
export function computeWindow(
  cadence: ReportCadence,
  now: Date
): { windowStart: Date; windowEnd: Date; prevStart: Date; prevEnd: Date } {
  const span = cadence === "weekly" ? 7 : 1;
  const windowEnd = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );
  const windowStart = new Date(windowEnd);
  windowStart.setUTCDate(windowStart.getUTCDate() - span);
  const prevEnd = new Date(windowStart);
  const prevStart = new Date(windowStart);
  prevStart.setUTCDate(prevStart.getUTCDate() - span);
  return { windowStart, windowEnd, prevStart, prevEnd };
}

async function loadTicketTypes(
  admin: AdminClient,
  eventId: string
): Promise<
  Array<{ id: string; name: string; capacity: number | null; quantity_sold: number }>
> {
  const { data, error } = await admin
    .from("ticket_types")
    .select("id, name, capacity, quantity_sold")
    .eq("event_id", eventId);
  if (error) {
    throw new Error(`ticket_types query failed: ${error.message}`);
  }
  return (data ?? []) as Array<{
    id: string;
    name: string;
    capacity: number | null;
    quantity_sold: number;
  }>;
}

async function loadAttendance(
  admin: AdminClient,
  eventId: string
): Promise<{ valid: number; checkedIn: number }> {
  const { data, error } = await admin
    .from("tickets")
    .select("status")
    .eq("event_id", eventId);
  if (error) {
    throw new Error(`tickets query failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{ status: string }>;
  let valid = 0;
  let checkedIn = 0;
  for (const r of rows) {
    if (r.status === "checked_in") checkedIn += 1;
    else if (r.status === "valid") valid += 1;
    // 'void' tickets are excluded from the attendance base entirely.
  }
  return { valid, checkedIn };
}

async function sumRefundsInWindow(
  admin: AdminClient,
  eventId: string,
  start: Date,
  end: Date
): Promise<number> {
  const { data, error } = await admin
    .from("orders")
    .select("refund_cents")
    .eq("event_id", eventId)
    .in("status", ["refunded", "partially_refunded"])
    .gte("refunded_at", start.toISOString())
    .lt("refunded_at", end.toISOString());
  if (error) {
    console.error("[event-ticket-report] refunds query failed", error);
    return 0;
  }
  const rows = (data ?? []) as Array<{ refund_cents: number | null }>;
  return rows.reduce((sum, r) => sum + (r.refund_cents ?? 0), 0);
}

async function countTicketsInWindow(
  admin: AdminClient,
  eventId: string,
  start: Date,
  end: Date
): Promise<number> {
  const { data, error } = await admin
    .from("orders")
    .select("tickets(id)")
    .eq("event_id", eventId)
    .eq("status", "paid")
    .gte("paid_at", start.toISOString())
    .lt("paid_at", end.toISOString());
  if (error) {
    console.error("[event-ticket-report] previous-window query failed", error);
    return 0;
  }
  const rows = (data ?? []) as Array<{ tickets: Array<{ id: string }> | null }>;
  return rows.reduce((sum, r) => sum + (r.tickets?.length ?? 0), 0);
}
