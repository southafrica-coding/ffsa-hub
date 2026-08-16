import type { Database, TablesInsert, TablesUpdate } from "@/types/database";
type EventInsert = TablesInsert<"events">;
type EventUpdate = TablesUpdate<"events">;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// Lifecycle groupings. "Closed out" events are done with — they're gone
// from the public site and hidden from the default Events list, but never
// deleted.
export const OPEN_EVENT_STATUSES = ["draft", "published"] as const;
export const CLOSED_EVENT_STATUSES = ["completed", "cancelled"] as const;

export function isClosedEventStatus(status: string) {
  return (CLOSED_EVENT_STATUSES as readonly string[]).includes(status);
}

export async function getEvents(
  supabase: Client,
  options?: {
    status?: string;
    statuses?: readonly string[];
    search?: string;
    upcoming?: boolean;
    limit?: number;
    offset?: number;
  }
) {
  let query = supabase
    .from("events")
    .select("*", { count: "exact" })
    .order("start_date", { ascending: true });

  if (options?.status) {
    query = query.eq("status", options.status);
  } else if (options?.statuses?.length) {
    query = query.in("status", options.statuses);
  }

  if (options?.search) {
    const term = `%${options.search}%`;
    query = query.or(`title.ilike.${term},description.ilike.${term},location.ilike.${term}`);
  }

  if (options?.upcoming) {
    query = query
      .gte("start_date", new Date().toISOString().split("T")[0])
      .eq("status", "published");
  }

  if (options?.limit) {
    const from = options.offset ?? 0;
    query = query.range(from, from + options.limit - 1);
  }

  return query;
}

// ────────────────────────────────────────────────────────────
// Attendance — "how many people are coming"
// ────────────────────────────────────────────────────────────

/**
 * The two paths a person can arrive on. They are alternatives, never a
 * sum: the ticket checkout also upserts an event_registrations row for
 * the buyer (see lib/ticketing/crm-resolution.ts), so adding them would
 * count the same human twice.
 */
export type AttendanceSource = "tickets" | "registrations";
export type EventAttendance = { count: number; source: AttendanceSource };

/** Tickets that are — or were, at the door — a seat someone holds. */
const ATTENDING_TICKET_STATUSES = ["valid", "checked_in"] as const;

/** One API page. Matches the platform's default max-rows ceiling. */
const ROW_PAGE_SIZE = 1000;

/**
 * Read every row a query matches, a page at a time. Same shape as the helper
 * in services/schools-analytics.ts. Only used on the pre-migration fallback
 * path below — where an unpaged read would undercount rather than error.
 */
async function readAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<{ data: T[]; error: unknown }> {
  const rows: T[] = [];
  for (let page = 0; ; page++) {
    const from = page * ROW_PAGE_SIZE;
    const { data, error } = await build(from, from + ROW_PAGE_SIZE - 1);
    if (error) return { data: rows, error };
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < ROW_PAGE_SIZE) return { data: rows, error: null };
  }
}

/**
 * Headcount per event, batched: exactly two reads for the whole list
 * (one on tickets, one on event_registrations), never one per event.
 *
 * The rule:
 *   - An event that has ever issued a ticket is a ticketed event. Its
 *     number is its non-void tickets — which is 0 for an event whose
 *     tickets were all refunded, and that is the honest answer. Falling
 *     back to registrations there would resurrect the refunded buyers.
 *   - Everything else reports live event_registrations.
 *
 * Never throws and never returns a partial picture: on any read error
 * (RLS legitimately hides tickets from finance/schools users) the map
 * comes back empty and callers render exactly as they did before this
 * number existed. Half the truth would be worse than none — a ticketed
 * event whose ticket read was blocked would silently report its much
 * smaller buyer-registration count as if it were the headcount.
 *
 * Counting is done in Postgres via v_event_attendance (migration 165) so
 * the numbers are exact. Until that migration is applied the view is
 * missing, and we fall back to tallying rows — PAGED, because the API
 * caps rows per response (1000 by default) and a single unpaged read
 * would quietly undercount any event past that many tickets. A wrong
 * headcount shown confidently is worse than a slow one.
 */
export async function getEventAttendanceCounts(
  supabase: Client,
  eventIds: string[]
): Promise<Map<string, EventAttendance>> {
  const out = new Map<string, EventAttendance>();
  // No ids means no query — an empty `.in()` is a wasted round trip.
  const ids = Array.from(new Set(eventIds)).filter(Boolean);
  if (ids.length === 0) return out;

  // Preferred path: Postgres does the counting, so nothing is capped.
  const view = await supabase
    .from("v_event_attendance")
    .select("event_id, ticket_rows, ticket_attending, registrations_active")
    .in("event_id", ids);

  if (!view.error && view.data) {
    for (const row of view.data as Array<{
      event_id: string;
      ticket_rows: number;
      ticket_attending: number;
      registrations_active: number;
    }>) {
      const ticketed = (row.ticket_rows ?? 0) > 0;
      out.set(row.event_id, {
        count: ticketed ? row.ticket_attending ?? 0 : row.registrations_active ?? 0,
        source: ticketed ? "tickets" : "registrations",
      });
    }
    for (const eventId of ids) {
      if (!out.has(eventId)) out.set(eventId, { count: 0, source: "registrations" });
    }
    return out;
  }

  // Fallback while migration 165 is unapplied. Same rule, tallied from rows —
  // paged, so a big event isn't silently truncated to the API's max-rows.
  // Voids come back too: they are how we know an event is ticketed at
  // all. They just don't count towards the headcount below.
  const [tickets, registrations] = await Promise.all([
    readAllRows<{ event_id: string; status: string }>((from, to) =>
      supabase
        .from("tickets")
        .select("event_id, status")
        .in("event_id", ids)
        .order("event_id")
        .range(from, to)
    ),
    // Matches getRegistrationCount() in services/registrations.ts —
    // everything except 'cancelled' (the only withdrawal status the
    // schema has; see migration 001). Pending and waitlisted people are
    // still coming as far as the roster is concerned.
    readAllRows<{ event_id: string }>((from, to) =>
      supabase
        .from("event_registrations")
        .select("event_id")
        .in("event_id", ids)
        .neq("status", "cancelled")
        .order("event_id")
        .range(from, to)
    ),
  ]);

  if (tickets.error || registrations.error) return out;

  const attending = new Set<string>(ATTENDING_TICKET_STATUSES);
  const ticketed = new Set<string>();
  for (const row of (tickets.data ?? []) as Array<{
    event_id: string;
    status: string;
  }>) {
    ticketed.add(row.event_id);
    if (!attending.has(row.status)) continue;
    const prev = out.get(row.event_id);
    out.set(row.event_id, {
      count: (prev?.count ?? 0) + 1,
      source: "tickets",
    });
  }
  // An all-void ticketed event has no row above; it is still ticketed,
  // and its honest headcount is zero.
  for (const eventId of ticketed) {
    if (!out.has(eventId)) out.set(eventId, { count: 0, source: "tickets" });
  }

  for (const row of (registrations.data ?? []) as Array<{ event_id: string }>) {
    if (ticketed.has(row.event_id)) continue;
    const prev = out.get(row.event_id);
    out.set(row.event_id, {
      count: (prev?.count ?? 0) + 1,
      source: "registrations",
    });
  }

  // Ids with neither tickets nor registrations are genuinely 0.
  for (const eventId of ids) {
    if (!out.has(eventId)) out.set(eventId, { count: 0, source: "registrations" });
  }

  return out;
}

export async function getEventById(supabase: Client, id: string) {
  return supabase.from("events").select("*").eq("id", id).single();
}

export async function getEventBySlug(supabase: Client, slug: string) {
  return supabase
    .from("events")
    .select("*")
    .eq("public_slug", slug)
    .maybeSingle();
}

export async function createEvent(supabase: Client, data: EventInsert) {
  return supabase.from("events").insert(data).select().single();
}

export async function updateEvent(
  supabase: Client,
  id: string,
  data: EventUpdate
) {
  return supabase.from("events").update(data).eq("id", id).select().single();
}

export async function publishEvent(supabase: Client, id: string) {
  return updateEvent(supabase, id, { status: "published" });
}

export async function cancelEvent(supabase: Client, id: string) {
  return updateEvent(supabase, id, { status: "cancelled" });
}

export async function completeEvent(supabase: Client, id: string) {
  return updateEvent(supabase, id, { status: "completed" });
}
