// Space Bookings — data access. New tables (venues / ministries /
// venue_bookings / booking_series) aren't in the generated database.ts yet,
// so this service uses the project's standard `Client = any` pattern and
// hand-written row types.

import { getRoleDerivedPermissionRows } from "@/services/permissions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type BookingStatusValue = "pending" | "approved" | "denied" | "cancelled";

export type Venue = {
  id: string;
  name: string;
  slug: string;
  building: string | null;
  description: string | null;
  capacity: number | null;
  color: string;
  is_active: boolean;
  requires_approval: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Ministry = {
  id: string;
  name: string;
  slug: string;
  color: string;
  is_active: boolean;
  sort_order: number;
  // Optional link to the real ministry roster (public.staff_ministries) —
  // an active leader of that ministry can then edit/cancel bookings tagged
  // with this one, in addition to the requester/admin/approver/manager.
  staff_ministry_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Booking = {
  id: string;
  venue_id: string;
  ministry_id: string | null;
  series_id: string | null;
  title: string;
  description: string | null;
  point_person: string | null;
  booking_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  setup_time: string | null;
  setdown_time: string | null;
  status: BookingStatusValue;
  decision_note: string | null;
  requested_by: string | null;
  requester_name: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type BookingRef = {
  venue?: Pick<Venue, "id" | "name" | "color" | "building" | "sort_order"> | null;
  ministry?: Pick<Ministry, "id" | "name" | "color" | "staff_ministry_id"> | null;
};

export type BookingWithRefs = Booking & BookingRef;

export type BookingSeries = {
  id: string;
  venue_id: string;
  ministry_id: string | null;
  ministry?: Pick<Ministry, "id" | "name" | "color" | "staff_ministry_id"> | null;
  title: string;
  description: string | null;
  point_person: string | null;
  weekday: number;
  start_time: string | null;
  end_time: string | null;
  setup_time: string | null;
  setdown_time: string | null;
  series_start: string;
  series_end: string;
  interval_weeks: number;
  status: BookingStatusValue;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type BookingAccess = {
  isAdmin: boolean;
  canView: boolean;
  canRequest: boolean;
  canApprove: boolean;
  canManage: boolean;
};

const VENUE_EMBED = "venue:venues(id,name,color,building,sort_order)";
const MINISTRY_EMBED = "ministry:ministries(id,name,color)";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ── Venues ─────────────────────────────────────────────────

export async function getVenues(
  supabase: Client,
  opts?: { activeOnly?: boolean }
) {
  let query = supabase
    .from("venues")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (opts?.activeOnly) query = query.eq("is_active", true);
  return query;
}

export async function createVenue(supabase: Client, data: Partial<Venue>) {
  return supabase.from("venues").insert(data).select().single();
}

/** Just a venue's approval setting — used by the create-booking route. */
export async function getVenueApproval(supabase: Client, id: string) {
  return supabase
    .from("venues")
    .select("requires_approval")
    .eq("id", id)
    .single();
}

export async function updateVenue(
  supabase: Client,
  id: string,
  data: Partial<Venue>
) {
  return supabase
    .from("venues")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
}

// ── Ministries ─────────────────────────────────────────────

export async function getMinistries(
  supabase: Client,
  opts?: { activeOnly?: boolean }
) {
  let query = supabase
    .from("ministries")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (opts?.activeOnly) query = query.eq("is_active", true);
  return query;
}

export async function createMinistry(supabase: Client, data: Partial<Ministry>) {
  return supabase.from("ministries").insert(data).select().single();
}

export async function updateMinistry(
  supabase: Client,
  id: string,
  data: Partial<Ministry>
) {
  return supabase
    .from("ministries")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
}

// ── Bookings ───────────────────────────────────────────────

export async function getBookings(
  supabase: Client,
  opts?: {
    from?: string;
    to?: string;
    venueId?: string;
    ministryId?: string;
    status?: string;
  }
) {
  let query = supabase
    .from("venue_bookings")
    .select(`*, ${VENUE_EMBED}, ${MINISTRY_EMBED}`)
    .order("booking_date", { ascending: true })
    .order("start_time", { ascending: true, nullsFirst: true });

  if (opts?.to) query = query.lte("booking_date", opts.to);
  if (opts?.from) {
    // Include multi-day bookings that started earlier but reach into the window.
    query = query.or(
      `end_date.gte.${opts.from},and(end_date.is.null,booking_date.gte.${opts.from})`
    );
  }
  if (opts?.venueId) query = query.eq("venue_id", opts.venueId);
  if (opts?.ministryId) query = query.eq("ministry_id", opts.ministryId);
  if (opts?.status) query = query.eq("status", opts.status);

  return query;
}

export async function getBookingById(supabase: Client, id: string) {
  return supabase
    .from("venue_bookings")
    .select(`*, venue:venues(*), ministry:ministries(*)`)
    .eq("id", id)
    .single();
}

/** Minimal columns for clash checking against one venue over a date range. */
export async function getVenueBookingsBetween(
  supabase: Client,
  venueId: string,
  from: string,
  to: string
) {
  return supabase
    .from("venue_bookings")
    .select(
      "id,venue_id,series_id,title,booking_date,end_date,setup_time,start_time,end_time,setdown_time,status,requester_name"
    )
    .eq("venue_id", venueId)
    .lte("booking_date", to)
    .or(`end_date.gte.${from},and(end_date.is.null,booking_date.gte.${from})`)
    .in("status", ["pending", "approved"]);
}

/** Count of all pending requests — for the manager's "Requests" badge. */
export async function countPendingBookings(supabase: Client): Promise<number> {
  const { count } = await supabase
    .from("venue_bookings")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

/** Every pending request, soonest first — the manager review queue. */
export async function getPendingRequests(supabase: Client) {
  return supabase
    .from("venue_bookings")
    .select(`*, ${VENUE_EMBED}, ${MINISTRY_EMBED}`)
    .eq("status", "pending")
    .order("booking_date", { ascending: true })
    .order("start_time", { ascending: true, nullsFirst: true });
}

/** Bookings a given user submitted — their "My requests" list (any status). */
export async function getMyRequests(supabase: Client, userId: string) {
  return supabase
    .from("venue_bookings")
    .select(`*, ${VENUE_EMBED}, ${MINISTRY_EMBED}`)
    .eq("requested_by", userId)
    .order("booking_date", { ascending: false });
}

/** A user's upcoming (today-onward, not cancelled) bookings — soonest first.
 *  Powers the dashboard "My Space Bookings" panel. */
export async function getMyUpcomingBookings(
  supabase: Client,
  userId: string,
  todayStr: string,
  limit = 12
) {
  return supabase
    .from("venue_bookings")
    .select(`*, ${VENUE_EMBED}, ${MINISTRY_EMBED}`)
    .eq("requested_by", userId)
    .gte("booking_date", todayStr)
    .neq("status", "cancelled")
    .order("booking_date", { ascending: true })
    .order("start_time", { ascending: true, nullsFirst: true })
    .limit(limit);
}

/** A user's recently DECIDED bookings (approved / denied) since `sinceIso`,
 *  newest decision first. Powers the requester's decision notifications. */
export async function getMyDecidedBookings(
  supabase: Client,
  userId: string,
  sinceIso: string,
  limit = 15
) {
  return supabase
    .from("venue_bookings")
    .select(`*, ${VENUE_EMBED}, ${MINISTRY_EMBED}`)
    .eq("requested_by", userId)
    .in("status", ["approved", "denied"])
    .gte("decided_at", sinceIso)
    .order("decided_at", { ascending: false })
    .limit(limit);
}

export async function getSeriesById(supabase: Client, id: string) {
  return supabase
    .from("booking_series")
    .select("*, ministry:ministries(*)")
    .eq("id", id)
    .single();
}

/** How many occurrences a series has (any status). */
export async function countBookingsInSeries(
  supabase: Client,
  seriesId: string
): Promise<number> {
  const { count } = await supabase
    .from("venue_bookings")
    .select("id", { count: "exact", head: true })
    .eq("series_id", seriesId);
  return count ?? 0;
}

/** Every occurrence of a series, oldest first. */
export async function getSeriesOccurrences(supabase: Client, seriesId: string) {
  return supabase
    .from("venue_bookings")
    .select("*")
    .eq("series_id", seriesId)
    .order("booking_date", { ascending: true });
}

// ── Mutations (kept here so routes/components never call .from() on the
//    typed client for tables that aren't in the generated database.ts) ──

export async function insertBooking(supabase: Client, row: Record<string, unknown>) {
  return supabase.from("venue_bookings").insert(row).select().single();
}

export async function insertBookings(
  supabase: Client,
  rows: Record<string, unknown>[]
) {
  return supabase.from("venue_bookings").insert(rows);
}

/** Hard-delete occurrences. Returns the ids actually removed — RLS can filter
 *  rows away silently, so callers check the result rather than assume. */
export async function deleteBookings(supabase: Client, ids: string[]) {
  return supabase.from("venue_bookings").delete().in("id", ids).select("id");
}

/** Cancel a set of occurrences by id — the fallback when a delete is blocked. */
export async function cancelBookings(supabase: Client, ids: string[]) {
  return supabase
    .from("venue_bookings")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .in("id", ids);
}

export async function updateBooking(
  supabase: Client,
  id: string,
  data: Record<string, unknown>
) {
  return supabase
    .from("venue_bookings")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
}

export async function insertSeries(supabase: Client, row: Record<string, unknown>) {
  return supabase.from("booking_series").insert(row).select().single();
}

export async function deleteSeries(supabase: Client, id: string) {
  return supabase.from("booking_series").delete().eq("id", id);
}

export async function updateSeries(
  supabase: Client,
  id: string,
  data: Record<string, unknown>
) {
  return supabase
    .from("booking_series")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
}

/** Update every occurrence of a series (optionally only the still-pending ones). */
export async function updateSeriesOccurrences(
  supabase: Client,
  seriesId: string,
  data: Record<string, unknown>,
  onlyPending = false,
  opts: {
    excludeId?: string;
    skipClosed?: boolean;
    /** Only occurrences after this ISO date — used to leave the past alone. */
    afterDate?: string;
    /** Only occurrences that still hold a given value, so per-occurrence
     *  overrides survive a series-wide change. */
    matchField?: { key: string; value: unknown };
  } = {}
) {
  let query = supabase
    .from("venue_bookings")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("series_id", seriesId);
  if (onlyPending) query = query.eq("status", "pending");
  // Don't reach back into occurrences that are already cancelled or denied.
  if (opts.skipClosed) query = query.not("status", "in", "(cancelled,denied)");
  if (opts.excludeId) query = query.neq("id", opts.excludeId);
  if (opts.afterDate) query = query.gt("booking_date", opts.afterDate);
  if (opts.matchField) {
    const { key, value } = opts.matchField;
    query = value === null ? query.is(key, null) : query.eq(key, value);
  }
  return query;
}

// ── Access ─────────────────────────────────────────────────

/** Resolve the current user's booking capabilities for UI gating. */
export async function getBookingAccess(
  supabase: Client,
  userId: string
): Promise<BookingAccess> {
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", ["super_admin", "admin"])
    .limit(1);

  if ((roleRows?.length ?? 0) > 0) {
    return {
      isAdmin: true,
      canView: true,
      canRequest: true,
      canApprove: true,
      canManage: true,
    };
  }

  // Direct grants and role-bundle grants are independent — read them together.
  const [{ data: permRows }, roleDerived] = await Promise.all([
    supabase
      .from("user_permissions")
      .select("permissions!inner(key,module)")
      .eq("user_id", userId)
      .eq("permissions.module", "bookings"),
    getRoleDerivedPermissionRows(supabase, userId),
  ]);

  const keys = new Set<string>();
  for (const row of permRows ?? []) {
    const perm = Array.isArray(row.permissions)
      ? row.permissions[0]
      : row.permissions;
    if (perm?.key) keys.add(perm.key);
  }

  // Also honor permissions granted via an assigned role's bundle — e.g. the
  // self_service floor grants bookings.view to every user. Mirrors RLS's
  // role-aware has_permission so UI gating matches actual access.
  for (const perm of roleDerived) {
    if (perm.module === "bookings") keys.add(perm.key);
  }

  return {
    isAdmin: false,
    canView: keys.size > 0,
    canRequest: keys.has("bookings.request"),
    canApprove: keys.has("bookings.approve"),
    canManage: keys.has("bookings.manage"),
  };
}
