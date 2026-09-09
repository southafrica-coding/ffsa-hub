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
import { callerIsAdmin } from "@/lib/auth/check-ministry-access";
import { staffSignupNotifyEmails } from "@/lib/email/send-new-staff-notice";
import {
  getInsuranceStatus,
  getInsuranceConfirmation,
  hasValidQueuedPolicy,
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

// New staff who FINISHED onboarding in the last two weeks. Distinct from
// staffApprovalNotifs above: that one covers people stuck at
// status='pending_approval', while self-service signups skip that state
// entirely and land active — so nobody heard about them at all.
//
// Scoped to the STAFF_SIGNUP_NOTIFY_EMAIL list (the same env var that drives
// the email notice) plus super_admins. Reading other users' rows needs the
// service-role client — see the users-RLS note on insuranceExpiryNotifs.
const NEW_STAFF_WINDOW_DAYS = 14;

async function newStaffOnboardedNotifs(
  supabase: Client,
  userId: string
): Promise<AppNotification[]> {
  const notifyList = staffSignupNotifyEmails();
  let allowed = false;
  if (notifyList.length > 0) {
    const { data: me } = await supabase
      .from("users")
      .select("email")
      .eq("id", userId)
      .maybeSingle();
    const myEmail = (me?.email ?? "").trim().toLowerCase();
    allowed = !!myEmail && notifyList.includes(myEmail);
  }
  if (!allowed) allowed = await isSuperAdmin(supabase, userId);
  if (!allowed) return [];

  const since = new Date(
    Date.now() - NEW_STAFF_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  const { data } = await admin
    .from("users")
    .select("id, first_name, last_name, display_name, email, accepted_at")
    .eq("signup_type", "staff")
    .gte("accepted_at", since)
    .order("accepted_at", { ascending: false })
    .limit(CAP);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[])
    .filter((u) => u.id !== userId) // never announce yourself to yourself
    .map((u) => {
      const { label, ts } = timeAgo(u.accepted_at);
      const name = personName(u);
      return {
        key: `new-staff:${u.id}`,
        kind: "user" as const,
        title: "New staff member joined",
        body: u.email ? `${name} · ${u.email}` : name,
        href: `/users/${u.id}`,
        when: label,
        ts,
        read: false,
      };
    });
}

// Tell vehicle approvers/managers that a request is waiting for a decision.
//
// This used to filter source='public' for the pasteable request link. That
// link is gone, and its `source` column was never actually applied to the
// database — so the filter matched nothing and approvers saw no vehicle
// notifications at all. Every pending request now counts.
async function vehicleRequestNotifs(supabase: Client, userId: string): Promise<AppNotification[]> {
  const access = await getVehicleAccess(supabase, userId);
  if (!(access.isAdmin || access.canApprove || access.canManage)) return [];
  const { data } = await supabase
    .from("vehicle_bookings")
    .select("id, booking_name, requester_name, checkout_date, return_date, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(CAP);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((b) => {
    const { label, ts } = timeAgo(b.created_at);
    return {
      key: `vehicle:${b.id}`,
      kind: "vehicle" as const,
      title: "Vehicle request awaiting approval",
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

// Beyond this, the stored date is a typo rather than a lapse — a mistyped year
// ("0028" for "2028") is the common one. Ten years is far past any real lapse.
const IMPLAUSIBLE_DAYS = 3650;

// How long an annual insurance re-confirmation may sit overdue before the
// dev team is told. The member sees a banner from 14 days BEFORE it's due,
// so this only fires on someone who has ignored it repeatedly.
const CONFIRM_NOTIFY_AFTER_DAYS = 30;

function expiryPhrase(daysLeft: number, date: string): string {
  if (daysLeft < 0) {
    const ago = Math.abs(daysLeft);
    // "expired 729821 days ago" is nonsense that buries the real alerts next
    // to it. Say what's actually wrong so someone fixes the record.
    if (ago > IMPLAUSIBLE_DAYS) {
      return `insurance expiry date looks wrong (${date}) — please correct it`;
    }
    return `insurance expired ${ago === 1 ? "yesterday" : `${ago} days ago`} (${date})`;
  }
  if (daysLeft === 0) return `insurance expires today (${date})`;
  if (daysLeft === 1) return `insurance expires tomorrow (${date})`;
  return `insurance expires in ${daysLeft} days (${date})`;
}

async function insuranceExpiryNotifs(supabase: Client, userId: string): Promise<AppNotification[]> {
  // Dev team (super_admin/admin) only. Ministry leaders used to receive their
  // own roster's expiry alerts; that was withdrawn because health insurance is
  // medical data and a ministry_leader membership is granted for roster admin,
  // not medical oversight. The empty led-ministry set below keeps the tier
  // logic intact while leaving only the dev_team tier reachable.
  const isDevTeam = await callerIsAdmin(supabase, userId);
  if (!isDevTeam) return [];
  const ledMinistryIds = new Set<string>();

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
       user:users!user_id(id, first_name, last_name, display_name, email, health_insurance_expiry_date, health_insurance_no_expiry, health_insurance_confirmed_at, next_health_insurance_provider, next_health_insurance_expiry_date, next_health_insurance_no_expiry)`
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

  // Open-ended policies that are badly overdue for their annual
  // re-confirmation. Dev team only, and only once someone has ignored the
  // banner for a month — nudging on every anniversary would drown the feed.
  const confirmOverdue = new Map<string, AppNotification>();

  for (const r of all) {
    const personId: string = r.user_id;
    if (personId === userId) continue; // never notify someone about themselves

    // Covered: a valid successor is queued and auto-takes-over when the current
    // policy lapses, so their leaders don't need an expiry alert.
    if (
      hasValidQueuedPolicy({
        next_health_insurance_provider: r.user?.next_health_insurance_provider,
        next_health_insurance_expiry_date: r.user?.next_health_insurance_expiry_date,
        next_health_insurance_no_expiry: r.user?.next_health_insurance_no_expiry,
      })
    ) {
      continue;
    }

    const status = getInsuranceStatus({
      health_insurance_expiry_date: r.user?.health_insurance_expiry_date,
      health_insurance_no_expiry: r.user?.health_insurance_no_expiry,
    });

    if (status.state === "no_expiry" && isDevTeam) {
      const confirmation = getInsuranceConfirmation({
        health_insurance_no_expiry: true,
        health_insurance_confirmed_at: r.user?.health_insurance_confirmed_at,
      });
      const overdueBy = -(confirmation.daysUntilDue ?? 0);
      if (confirmation.dueOn && overdueBy >= CONFIRM_NOTIFY_AFTER_DAYS) {
        confirmOverdue.set(personId, {
          key: `insurance-confirm:${personId}:${confirmation.dueOn}`,
          kind: "insurance",
          title: "Insurance confirmation overdue",
          body: `${personName(r.user)} · ${
            r.ministry?.name ?? "their ministry"
          } — hasn't confirmed their medical scheme is still active (due ${confirmation.dueOn})`,
          href: `/users/${personId}`,
          when: "",
          ts: Date.now() - overdueBy * 86_400_000,
          read: false,
        });
      }
    }

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

  const expiryNotifs = Array.from(byPerson.values())
    .sort((a, b) => a._days - b._days)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .map(({ _days, _tier, ...n }) => n);

  // Expiry first (someone is or is about to be uninsured), then the slower
  // confirmation chase.
  return [...expiryNotifs, ...confirmOverdue.values()].slice(0, CAP);
}

const PROVIDERS = [bookingNotifs, bookingDecisionNotifs, staffApprovalNotifs, newStaffOnboardedNotifs, vehicleRequestNotifs, recordsMatchNotifs, insuranceExpiryNotifs];

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
