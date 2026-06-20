// Dashboard notification feed — DERIVED from the actionable items across
// modules on each load (no event-sourcing yet). Each actionable item becomes a
// notification with a STABLE key; per-user read state lives in
// `notification_reads` (migration 096).
//
// Providers are permission-gated and wrapped so a failing/slow one degrades to
// "no notifications" rather than breaking the dashboard. Four ship today
// (booking requests for approvers, booking decisions for the requester, staff
// approvals, records-to-match — all readable via the user's RLS client).
// Prayer-room applications (needs the admin client), event
// follow-ups (assignment model) and possible-duplicates (full-scan cost) are
// the natural next providers.

import { getBookingAccess, getPendingRequests, getMyDecidedBookings } from "./bookings";
import { dateRangeLabel } from "@/lib/bookings/dates";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type AppNotification = {
  key: string; // stable identity, e.g. "booking:<uuid>"
  kind: "booking" | "user" | "records";
  title: string;
  body: string;
  href: string;
  when: string; // server-formatted relative time ("2h ago"); "" if none
  ts: number; // epoch ms for sorting (0 = no time)
  read: boolean;
};

const CAP = 15; // per-provider, to keep the feed sane

function timeAgo(iso: string | null | undefined): { label: string; ts: number } {
  if (!iso) return { label: "", ts: 0 };
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return { label: "", ts: 0 };
  const m = Math.floor(Math.max(0, Date.now() - ts) / 60000);
  if (m < 1) return { label: "just now", ts };
  if (m < 60) return { label: `${m}m ago`, ts };
  const h = Math.floor(m / 60);
  if (h < 24) return { label: `${h}h ago`, ts };
  const d = Math.floor(h / 24);
  if (d < 7) return { label: `${d}d ago`, ts };
  return { label: `${Math.floor(d / 7)}w ago`, ts };
}

async function isSuperAdmin(supabase: Client, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .eq("roles.name", "super_admin")
    .limit(1);
  return !!(data && data.length > 0);
}

async function hasModuleAccess(
  supabase: Client,
  userId: string,
  module: string
): Promise<boolean> {
  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .in("roles.name", ["super_admin", "admin"])
    .limit(1);
  if (roleRows && roleRows.length > 0) return true;
  const { data: perm } = await supabase
    .from("user_permissions")
    .select("permissions!inner(module)")
    .eq("user_id", userId)
    .eq("permissions.module", module)
    .limit(1);
  return !!(perm && perm.length > 0);
}

// ── Providers ──────────────────────────────────────────────

async function bookingNotifs(supabase: Client, userId: string): Promise<AppNotification[]> {
  const access = await getBookingAccess(supabase, userId);
  if (!access.canApprove) return [];
  const { data } = await getPendingRequests(supabase);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (((data ?? []) as any[]).slice(0, CAP)).map((b) => {
    const { label, ts } = timeAgo(b.created_at);
    return {
      key: `booking:${b.id}`,
      kind: "booking" as const,
      title: "New booking request",
      body: `${b.title} · ${b.venue?.name ?? "venue"} · ${dateRangeLabel(b.booking_date, b.end_date)}`,
      href: "/bookings/requests",
      when: label,
      ts,
      read: false,
    };
  });
}

// The flip side of bookingNotifs: tell the REQUESTER when their own booking was
// approved or denied. Gated simply by ownership (requested_by = self), so any
// staff member who makes space bookings hears back. Keyed by status so a later
// decision change re-surfaces after an earlier one was read.
async function bookingDecisionNotifs(supabase: Client, userId: string): Promise<AppNotification[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await getMyDecidedBookings(supabase, userId, since, 60);

  // Collapse a recurring weekly series to ONE notification per status — same
  // reasoning as the "My Space Bookings" panel, so a weekly booking doesn't
  // fire the same "approved" notice for every occurrence. Rows arrive newest
  // decision first, so the first per group is the one we keep.
  const seen = new Set<string>();
  const out: AppNotification[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const b of (data ?? []) as any[]) {
    const group = b.series_id
      ? `s:${b.series_id}`
      : `sig:${b.title}|${b.venue_id}|${b.start_time}|${b.end_time}`;
    const dedup = `${group}:${b.status}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    const { label, ts } = timeAgo(b.decided_at);
    const approved = b.status === "approved";
    const recurring = !!b.series_id;
    const where = `${b.title} · ${b.venue?.name ?? "venue"} · ${recurring ? "weekly" : dateRangeLabel(b.booking_date, b.end_date)}`;
    const body = !approved && b.decision_note ? `${where} — ${b.decision_note}` : where;
    out.push({
      key: `booking-decision:${group}:${b.status}`,
      kind: "booking" as const,
      title: approved ? "Booking approved" : "Booking declined",
      body,
      href: "/bookings",
      when: label,
      ts,
      read: false,
    });
    if (out.length >= CAP) break;
  }
  return out;
}

async function staffApprovalNotifs(supabase: Client, userId: string): Promise<AppNotification[]> {
  if (!(await isSuperAdmin(supabase, userId))) return [];
  const { data } = await supabase
    .from("users")
    .select("id, first_name, last_name, email, created_at")
    .eq("status", "pending_approval")
    .order("created_at", { ascending: false })
    .limit(CAP);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((u) => {
    const { label, ts } = timeAgo(u.created_at);
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email || "New staff member";
    return {
      key: `user:${u.id}`,
      kind: "user" as const,
      title: "Staff awaiting approval",
      body: u.email ? `${name} · ${u.email}` : name,
      href: "/users?filter=pending",
      when: label,
      ts,
      read: false,
    };
  });
}

async function recordsMatchNotifs(supabase: Client, userId: string): Promise<AppNotification[]> {
  if (!(await hasModuleAccess(supabase, userId, "records-library"))) return [];
  const { count } = await supabase
    .from("library_match_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (!count || count < 1) return [];
  return [
    {
      // keyed by count so a growing queue re-surfaces after being read
      key: `records-match:${count}`,
      kind: "records" as const,
      title: "Records awaiting match",
      body: `${count} imported record${count === 1 ? "" : "s"} need matching to a profile`,
      href: "/records-library/match-queue",
      when: "",
      ts: Date.now(),
      read: false,
    },
  ];
}

const PROVIDERS = [bookingNotifs, bookingDecisionNotifs, staffApprovalNotifs, recordsMatchNotifs];

// ── Public API ─────────────────────────────────────────────

export async function getNotifications(
  supabase: Client,
  userId: string
): Promise<{ notifications: AppNotification[]; unreadCount: number }> {
  const results = await Promise.all(
    PROVIDERS.map((p) => p(supabase, userId).catch(() => [] as AppNotification[]))
  );
  const all = results.flat();
  if (all.length === 0) return { notifications: [], unreadCount: 0 };

  // Read state (table may not exist yet → everything reads as unread).
  const { data: readRows } = await supabase
    .from("notification_reads")
    .select("notification_key")
    .eq("user_id", userId);
  const readKeys = new Set<string>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((readRows ?? []) as any[]).map((r) => r.notification_key)
  );

  const notifications = all
    .map((n) => ({ ...n, read: readKeys.has(n.key) }))
    .sort((a, b) => (a.read !== b.read ? (a.read ? 1 : -1) : b.ts - a.ts));

  return {
    notifications,
    unreadCount: notifications.filter((n) => !n.read).length,
  };
}

export async function markNotificationsRead(
  supabase: Client,
  userId: string,
  keys: string[]
) {
  if (!keys.length) return { error: null };
  const rows = keys.map((notification_key) => ({ user_id: userId, notification_key }));
  return supabase
    .from("notification_reads")
    .upsert(rows, { onConflict: "user_id,notification_key" });
}
