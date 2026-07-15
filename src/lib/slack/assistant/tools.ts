/**
 * Tool catalog for the Slack Q&A assistant (v2a — curated tools).
 *
 * Claude is given these tool definitions and decides which to call
 * with what arguments. The model never writes SQL here — it only
 * invokes these vetted, read-only functions, so the numbers are
 * trustworthy and the data access is bounded.
 *
 * Each tool runs via createAdminClient() (service role — the bot has
 * no logged-in user, same approach as the daily ticket report). Fuzzy
 * resolvers wrap the existing ilike search service functions; when a
 * name is ambiguous they return candidates so Claude asks the user to
 * disambiguate rather than guessing.
 *
 * All time windows are computed in Africa/Johannesburg (SAST, UTC+2,
 * no DST) so "today" / "tonight" / "this week" match the team's clock.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLabels, getLabelContacts } from "@/services/labels";
import { getEvents } from "@/services/events";
import { getPrograms } from "@/services/schools";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

// ────────────────────────────────────────────────────────────
// Time windows (SAST)
// ────────────────────────────────────────────────────────────

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000; // UTC+2, no DST

type Period = "today" | "this_week" | "this_month" | "all";

/** UTC instant of the start of the current SAST calendar day. */
function sastDayStartUtc(now: Date): Date {
  const sast = new Date(now.getTime() + SAST_OFFSET_MS); // SAST wall-clock in UTC fields
  const startAsUtc = Date.UTC(
    sast.getUTCFullYear(),
    sast.getUTCMonth(),
    sast.getUTCDate(),
    0,
    0,
    0,
    0
  );
  return new Date(startAsUtc - SAST_OFFSET_MS);
}

function resolvePeriod(
  period: Period | undefined,
  now: Date = new Date()
): { start: Date | null; end: Date | null; label: string } {
  const p = period ?? "all";
  if (p === "all") return { start: null, end: null, label: "all time" };

  const dayStart = sastDayStartUtc(now);

  if (p === "today") {
    return { start: dayStart, end: now, label: "today (SAST)" };
  }
  if (p === "this_week") {
    // SAST week starts Monday. getUTCDay on the SAST wall-clock date.
    const sast = new Date(now.getTime() + SAST_OFFSET_MS);
    const dow = sast.getUTCDay(); // 0=Sun..6=Sat
    const daysSinceMonday = (dow + 6) % 7;
    const weekStart = new Date(
      dayStart.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000
    );
    return { start: weekStart, end: now, label: "this week (SAST, since Monday)" };
  }
  // this_month
  const sast = new Date(now.getTime() + SAST_OFFSET_MS);
  const monthStartAsUtc = Date.UTC(
    sast.getUTCFullYear(),
    sast.getUTCMonth(),
    1,
    0,
    0,
    0,
    0
  );
  return {
    start: new Date(monthStartAsUtc - SAST_OFFSET_MS),
    end: now,
    label: "this month (SAST)",
  };
}

// ────────────────────────────────────────────────────────────
// Fuzzy resolvers
// ────────────────────────────────────────────────────────────

type Resolved =
  | { kind: "ok"; id: string; name: string }
  | { kind: "ambiguous"; candidates: Array<{ id: string; name: string }> }
  | { kind: "not_found"; term: string };

function rankMatch(
  term: string,
  rows: Array<{ id: string; name: string; alt?: string | null }>
): Resolved {
  if (rows.length === 0) return { kind: "not_found", term };
  const t = term.trim().toLowerCase();
  // Exact (name or alt slug/code) wins outright.
  const exact = rows.find(
    (r) =>
      r.name.toLowerCase() === t || (r.alt ?? "").toLowerCase() === t
  );
  if (exact) return { kind: "ok", id: exact.id, name: exact.name };
  if (rows.length === 1) return { kind: "ok", id: rows[0].id, name: rows[0].name };
  return {
    kind: "ambiguous",
    candidates: rows.slice(0, 6).map((r) => ({ id: r.id, name: r.name })),
  };
}

async function resolveLabel(admin: AdminClient, term: string): Promise<Resolved> {
  const { data } = await getLabels(admin, { search: term });
  return rankMatch(
    term,
    (data ?? []).map((l: { id: string; name: string; slug: string }) => ({
      id: l.id,
      name: l.name,
      alt: l.slug,
    }))
  );
}

async function resolveEvent(admin: AdminClient, term: string): Promise<Resolved> {
  const { data } = await getEvents(admin, { search: term, limit: 10 });
  return rankMatch(
    term,
    (data ?? []).map((e: { id: string; title: string; public_slug: string | null }) => ({
      id: e.id,
      name: e.title,
      alt: e.public_slug,
    }))
  );
}

async function resolveProgram(admin: AdminClient, term: string): Promise<Resolved> {
  const { data } = await getPrograms(admin, { search: term });
  return rankMatch(
    term,
    (data ?? []).map((p: { id: string; name: string; code: string }) => ({
      id: p.id,
      name: p.name,
      alt: p.code,
    }))
  );
}

/** Shared shape returned when a name couldn't be pinned down. */
function unresolved(r: Resolved, kind: string) {
  if (r.kind === "ambiguous") {
    return {
      needs_clarification: true,
      message: `Multiple ${kind}s match that. Which one?`,
      candidates: r.candidates.map((c) => c.name),
    };
  }
  return {
    not_found: true,
    message: `No ${kind} found matching "${r.kind === "not_found" ? r.term : ""}".`,
  };
}

// ────────────────────────────────────────────────────────────
// Tool implementations
// ────────────────────────────────────────────────────────────

async function countContactsByLabel(input: {
  label: string;
  include_names?: boolean;
}) {
  const admin = createAdminClient();
  const r = await resolveLabel(admin, input.label);
  if (r.kind !== "ok") return unresolved(r, "label");

  const { data, count, error } = await getLabelContacts(admin, r.id, {
    limit: input.include_names ? 50 : 1,
  });
  if (error) return { error: error.message };

  const result: Record<string, unknown> = { label: r.name, count: count ?? 0 };
  if (input.include_names) {
    result.names = (data ?? [])
      .map((row: { contacts?: { first_name?: string; last_name?: string } }) =>
        `${row.contacts?.first_name ?? ""} ${row.contacts?.last_name ?? ""}`.trim()
      )
      .filter(Boolean);
    if ((count ?? 0) > 50) result.names_truncated_to = 50;
  }
  return result;
}

async function ticketSales(input: { event?: string; period?: Period }) {
  const admin = createAdminClient();
  let eventId: string | null = null;
  let eventName = "all events";
  if (input.event) {
    const r = await resolveEvent(admin, input.event);
    if (r.kind !== "ok") return unresolved(r, "event");
    eventId = r.id;
    eventName = r.name;
  }

  const window = resolvePeriod(input.period);
  let query = admin
    .from("orders")
    .select("id, total_cents, tickets(id)", { count: "exact" })
    .eq("status", "paid");
  if (eventId) query = query.eq("event_id", eventId);
  if (window.start) query = query.gte("paid_at", window.start.toISOString());
  if (window.end) query = query.lt("paid_at", window.end.toISOString());

  const { data, count, error } = await query;
  if (error) return { error: error.message };

  const rows = (data ?? []) as Array<{
    total_cents: number | null;
    tickets: Array<{ id: string }> | null;
  }>;
  const tickets = rows.reduce((s, o) => s + (o.tickets?.length ?? 0), 0);
  const revenueCents = rows.reduce((s, o) => s + (o.total_cents ?? 0), 0);

  return {
    event: eventName,
    period: window.label,
    tickets_sold: tickets,
    paid_orders: count ?? rows.length,
    revenue_rand: Math.round(revenueCents) / 100,
  };
}

async function checkinCount(input: { event?: string; period?: Period }) {
  const admin = createAdminClient();
  let eventId: string | null = null;
  let eventName = "all events";
  if (input.event) {
    const r = await resolveEvent(admin, input.event);
    if (r.kind !== "ok") return unresolved(r, "event");
    eventId = r.id;
    eventName = r.name;
  }

  const window = resolvePeriod(input.period ?? "today");
  let q = admin
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("status", "checked_in");
  if (eventId) q = q.eq("event_id", eventId);
  if (window.start) q = q.gte("checked_in_at", window.start.toISOString());
  if (window.end) q = q.lt("checked_in_at", window.end.toISOString());
  const { count: checkedIn, error } = await q;
  if (error) return { error: error.message };

  const result: Record<string, unknown> = {
    event: eventName,
    period: window.label,
    checked_in: checkedIn ?? 0,
  };

  // For a specific event, also give the issued-ticket total so the
  // model can phrase "312 of 820".
  if (eventId) {
    const { count: total } = await admin
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .neq("status", "void");
    result.tickets_issued = total ?? 0;
  }
  return result;
}

const APPLICATION_STATUSES = [
  "submitted",
  "references_received",
  "interview_scheduled",
  "accepted",
  "rejected",
  "waitlisted",
  "cancelled",
] as const;

async function applicationStats(input: {
  program?: string;
  status?: string;
  period?: Period;
}) {
  const admin = createAdminClient();
  let programId: string | null = null;
  let programName = "all programs";
  if (input.program) {
    const r = await resolveProgram(admin, input.program);
    if (r.kind !== "ok") return unresolved(r, "program");
    programId = r.id;
    programName = r.name;
  }

  const window = resolvePeriod(input.period);

  if (input.status) {
    let q = admin
      .from("application_responses")
      .select("id", { count: "exact", head: true })
      .eq("status", input.status);
    if (programId) q = q.eq("program_id", programId);
    if (window.start) q = q.gte("submitted_at", window.start.toISOString());
    if (window.end) q = q.lt("submitted_at", window.end.toISOString());
    const { count, error } = await q;
    if (error) return { error: error.message };
    return {
      program: programName,
      status: input.status,
      period: window.label,
      count: count ?? 0,
    };
  }

  // No status → bucket counts by status.
  let q = admin.from("application_responses").select("status").limit(5000);
  if (programId) q = q.eq("program_id", programId);
  if (window.start) q = q.gte("submitted_at", window.start.toISOString());
  if (window.end) q = q.lt("submitted_at", window.end.toISOString());
  const { data, error } = await q;
  if (error) return { error: error.message };

  const byStatus: Record<string, number> = {};
  for (const s of APPLICATION_STATUSES) byStatus[s] = 0;
  let total = 0;
  for (const row of (data ?? []) as Array<{ status: string }>) {
    if (row.status in byStatus) byStatus[row.status] += 1;
    else byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    total += 1;
  }
  return { program: programName, period: window.label, total, by_status: byStatus };
}

// ────────────────────────────────────────────────────────────
// Dispatcher
// ────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  try {
    switch (name) {
      case "count_contacts_by_label":
        return await countContactsByLabel(input as { label: string; include_names?: boolean });
      case "ticket_sales":
        return await ticketSales(input as { event?: string; period?: Period });
      case "checkin_count":
        return await checkinCount(input as { event?: string; period?: Period });
      case "application_stats":
        return await applicationStats(
          input as { program?: string; status?: string; period?: Period }
        );
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ────────────────────────────────────────────────────────────
// Catalog (the schemas Claude sees)
// ────────────────────────────────────────────────────────────

const PERIOD_SCHEMA = {
  type: "string" as const,
  enum: ["today", "this_week", "this_month", "all"],
  description:
    "Time window in SAST. 'today' covers tonight/so-far-today. Omit or 'all' for all-time.",
};

export const CURATED_TOOLS: Anthropic.Tool[] = [
  {
    name: "count_contacts_by_label",
    description:
      "Count contacts assigned a given CRM label/segment (e.g. 'The Send', 'Newsletter'). Returns the exact count, and optionally the contact names.",
    input_schema: {
      type: "object",
      properties: {
        label: {
          type: "string",
          description: "Label name or slug, e.g. 'Send' or 'the-send'.",
        },
        include_names: {
          type: "boolean",
          description:
            "If true, also list contact names (PII; up to 50). Only when the user asks who, not just how many.",
        },
      },
      required: ["label"],
    },
  },
  {
    name: "ticket_sales",
    description:
      "Count tickets sold (from paid orders) and revenue, optionally for one event and/or a time period. Omit event for all events.",
    input_schema: {
      type: "object",
      properties: {
        event: {
          type: "string",
          description: "Event title or slug, e.g. 'The Send'. Omit for all events.",
        },
        period: PERIOD_SCHEMA,
      },
      required: [],
    },
  },
  {
    name: "checkin_count",
    description:
      "Count tickets checked in at the door, optionally for one event and/or period. Defaults to today (tonight). For a specific event it also returns total tickets issued.",
    input_schema: {
      type: "object",
      properties: {
        event: {
          type: "string",
          description: "Event title or slug. Omit for all events.",
        },
        period: PERIOD_SCHEMA,
      },
      required: [],
    },
  },
  {
    name: "application_stats",
    description:
      "Count school/program applications, optionally for one program, one status, and/or a period. Without a status it returns a breakdown by status.",
    input_schema: {
      type: "object",
      properties: {
        program: {
          type: "string",
          description: "Program name or code, e.g. 'DTS' or 'DTS Cape Town'. Omit for all programs.",
        },
        status: {
          type: "string",
          enum: [...APPLICATION_STATUSES],
          description: "Filter to one application status.",
        },
        period: PERIOD_SCHEMA,
      },
      required: [],
    },
  },
];
