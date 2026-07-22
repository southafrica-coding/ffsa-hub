// Dashboard notification feed — DERIVED from the actionable items across
// modules on each load (no event-sourcing yet). Each actionable item becomes a
// notification with a STABLE key; per-user read state lives in
// `notification_reads` (migration 096).
//
// Providers are permission-gated and wrapped so a failing/slow one degrades to
// "no notifications" rather than breaking the dashboard. Five ship today
// (booking requests for approvers, booking decisions for the requester, staff
// approvals, public vehicle requests, records-to-match — all readable via the
// user's RLS client).
// Prayer-room applications (needs the admin client), event
// follow-ups (assignment model) and possible-duplicates (full-scan cost) are
// the natural next providers.

import { getBookingAccess, getPendingRequests, getMyDecidedBookings } from "./bookings";
import { getVehicleAccess } from "./vehicles";
import { dateRangeLabel } from "@/lib/bookings/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerIsAdmin, getLedMinistryIds } from "@/lib/auth/check-ministry-access";
import {
  getInsuranceStatus,
  INSURANCE_LEADER_ALERT_DAYS,
  INSURANCE_DEV_TEAM_ALERT_DAYS,
} from "@/lib/users/profile-fields";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type AppNotification = {
  key: string; // stable identity, e.g. "booking:<uuid>"
  kind: "booking" | "user" | "records" | "vehicle" | "insurance";
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

// Tell vehicle approvers/managers when a request arrives through the PUBLIC
// link (people outside the Hub). Internal requesters can't see this feed, so
// it's scoped to source='public' — the external requests that need a human's
// eyes the most.
async function vehicleRequestNotifs(supabase: Client, userId: string): Promise<AppNotification[]> {
  const access = await getVehicleAccess(supabase, userId);
  if (!(access.isAdmin || access.canApprove || access.canManage)) return [];
  const { data } = await supabase
    .from("vehicle_bookings")
    .select("id, booking_name, requester_name, checkout_date, return_date, created_at")
    .eq("status", "pending")
    .eq("source", "public")
    .order("created_at", { ascending: false })
    .limit(CAP);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((b) => {
    const { label, ts } = timeAgo(b.created_at);
    return {
      key: `vehicle:${b.id}`,
      kind: "vehicle" as const,
      title: "New vehicle request (public link)",
      body: `${b.booking_name}${b.requester_name ? ` · ${b.requester_name}` : ""} · ${dateRangeLabel(b.checkout_date, b.return_date)}`,
      href: "/bookings/vehicles/requests",
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

// Health-insurance expiry, escalated up the ministry hierarchy. A leader is
// nudged on their dashboard when one of THEIR people is within 4 weeks of a
// lapse and hasn't renewed; the development team (super_admin/admin) is the
// 1-week catch-all for everyone, and the direct recipient for point leaders
// and anyone in the Leadership Team ministry. See INSURANCE_*_ALERT_DAYS.
//
// Unlike the other providers, this one reads OTHER users' insurance + roster
// data, which a Ministry Leader has no RLS access to (users read only their
// own row — the users-table embedded-join gotcha). So it uses the service-role
// client for the cross-user scan and then exposes to the viewer ONLY the rows
// they're entitled to (their ministry's people / dev-team scope) — the
// standard "service-role for cross-user reporting, filter server-side" pattern.
type EscalationTier = "leader" | "point_leader" | "dev_team";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function personName(u: any): string {
  return (
    u?.display_name ||
    [u?.first_name, u?.last_name].filter(Boolean).join(" ") ||
    u?.email ||
    "A team member"
  );
}

function expiryPhrase(daysLeft: number, date: string): string {
  if (daysLeft < 0) {
    const ago = Math.abs(daysLeft);
    return `insurance expired ${ago === 1 ? "yesterday" : `${ago} days ago`} (${date})`;
  }
  if (daysLeft === 0) return `insurance expires today (${date})`;
  if (daysLeft === 1) return `insurance expires tomorrow (${date})`;
  return `insurance expires in ${daysLeft} days (${date})`;
}

async function insuranceExpiryNotifs(supabase: Client, userId: string): Promise<AppNotification[]> {
  // Fast path: only leaders and the dev team ever receive these.
  const isDevTeam = await callerIsAdmin(supabase, userId);
  const ledMinistryIds = new Set(await getLedMinistryIds(supabase, userId));
  if (!isDevTeam && ledMinistryIds.size === 0) return [];

  // Cross-user scan (service-role): every active membership with the member's
  // insurance + the ministry's slug, so we can resolve both the affected
  // people and each ministry's leader/point-leader structure in one pass.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  const { data: rows } = await admin
    .from("staff_ministry_members")
    .select(
      `user_id, member_role, is_point_leader, staff_ministry_id,
       ministry:staff_ministries!staff_ministry_id(id, name, slug),
       user:users!user_id(id, first_name, last_name, display_name, email, health_insurance_expiry_date)`
    )
    .eq("status", "active");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = (rows ?? []) as any[];
  if (all.length === 0) return [];

  // Per-ministry point leader, so we can route ministry-leader alerts to them.
  const pointLeaderByMinistry = new Map<string, string>();
  for (const r of all) {
    if (r.is_point_leader) pointLeaderByMinistry.set(r.staff_ministry_id, r.user_id);
  }

  // One notification per affected person; keep the most urgent (and prefer the
  // dev-team tier on ties) if they surface via more than one ministry.
  const byPerson = new Map<string, AppNotification & { _days: number; _tier: EscalationTier }>();
  const tierRank: Record<EscalationTier, number> = { dev_team: 3, point_leader: 2, leader: 1 };

  for (const r of all) {
    const personId: string = r.user_id;
    if (personId === userId) continue; // never notify someone about themselves

    const status = getInsuranceStatus({
      health_insurance_expiry_date: r.user?.health_insurance_expiry_date,
    });
    const daysLeft = status.daysLeft;
    if (status.expiryDate === null || daysLeft === null) continue; // missing → own block handles it
    if (daysLeft > INSURANCE_LEADER_ALERT_DAYS) continue; // outside the 4-week window

    const ministryId: string = r.staff_ministry_id;
    const isLeadershipTeam = r.ministry?.slug === "leadership_team";
    const pIsPointLeader = r.is_point_leader === true;
    const pIsLeader = r.member_role === "leader";
    const hasPointLeader = pointLeaderByMinistry.has(ministryId);

    // Route to the right tier. Leadership Team + point leaders go straight to
    // the dev team; a ministry leader routes to their point leader (falling
    // back to the dev team if the ministry has none); a plain member routes to
    // their ministry's leaders. The 1-week mark adds the dev team for everyone.
    const ltOrPoint = isLeadershipTeam || pIsPointLeader;
    const devTeamApplies =
      ltOrPoint || (pIsLeader && !hasPointLeader) || daysLeft <= INSURANCE_DEV_TEAM_ALERT_DAYS;
    const pointApplies = !ltOrPoint && pIsLeader && hasPointLeader;
    const leaderApplies = !ltOrPoint && !pIsLeader;

    let tier: EscalationTier | null = null;
    if (devTeamApplies && isDevTeam) tier = "dev_team";
    else if (pointApplies && pointLeaderByMinistry.get(ministryId) === userId) tier = "point_leader";
    else if (leaderApplies && ledMinistryIds.has(ministryId)) tier = "leader";
    if (!tier) continue;

    const name = personName(r.user);
    const ministryName = r.ministry?.name ?? "their ministry";
    const expired = daysLeft < 0;
    const notif: AppNotification & { _days: number; _tier: EscalationTier } = {
      key: `insurance-expiry:${personId}:${status.expiryDate}`,
      kind: "insurance",
      title: expired ? "Team member's insurance expired" : "Team member's insurance expiring",
      body: `${name} · ${ministryName} — ${expiryPhrase(daysLeft, status.expiryDate)}`,
      href: tier === "dev_team" ? `/users/${personId}` : `/ministry/${ministryId}`,
      when: "",
      // Sort nearer-expiry (and already-expired) first within the feed.
      ts: Date.now() - daysLeft * 86_400_000,
      read: false,
      _days: daysLeft,
      _tier: tier,
    };

    const existing = byPerson.get(personId);
    if (
      !existing ||
      notif._days < existing._days ||
      (notif._days === existing._days && tierRank[tier] > tierRank[existing._tier])
    ) {
      byPerson.set(personId, notif);
    }
  }

  return Array.from(byPerson.values())
    .sort((a, b) => a._days - b._days)
    .slice(0, CAP)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .map(({ _days, _tier, ...n }) => n);
}

const PROVIDERS = [bookingNotifs, bookingDecisionNotifs, staffApprovalNotifs, vehicleRequestNotifs, recordsMatchNotifs, insuranceExpiryNotifs];

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
