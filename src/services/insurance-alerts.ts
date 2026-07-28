// Viewer-scoped "staff health insurance needs attention" list, powering the
// dashboard staff-insurance widget. Shares the classification primitives with
// the notification feed (getInsuranceStatus + the alert thresholds), but —
// unlike insuranceExpiryNotifs — it INCLUDES the "missing" case (no policy on
// file) and returns a plain list scoped to the viewer rather than routed
// notifications.
//
// Escalation, mirroring the ministry-tab model:
//   - ministry leaders / point leaders → their ministries' staff
//   - dev team (super_admin/admin)     → everyone, org-wide
//
// Reads other users' insurance + roster data (which a ministry leader has no
// RLS access to), so it uses the service-role client for the cross-user scan
// and only ever returns rows the viewer is entitled to.

import { createAdminClient } from "@/lib/supabase/admin";
import { callerIsAdmin, getLedMinistryIds } from "@/lib/auth/check-ministry-access";
import {
  getInsuranceStatus,
  INSURANCE_LEADER_ALERT_DAYS,
} from "@/lib/users/profile-fields";

// The Supabase generic is heavy; match the services convention.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type StaffInsuranceState = "missing" | "expired" | "expiring";

export type StaffInsuranceAlert = {
  userId: string;
  name: string;
  ministryId: string;
  ministryName: string;
  state: StaffInsuranceState;
  expiryDate: string | null;
  daysLeft: number | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function personName(u: any): string {
  return (
    u?.display_name ||
    [u?.first_name, u?.last_name].filter(Boolean).join(" ") ||
    u?.email ||
    "A team member"
  );
}

// Expired first, then missing, then soonest-expiring.
function urgencyRank(state: StaffInsuranceState): number {
  return state === "expired" ? 0 : state === "missing" ? 1 : 2;
}

export async function getStaffInsuranceAlerts(
  supabase: Client,
  userId: string
): Promise<StaffInsuranceAlert[]> {
  const isDevTeam = await callerIsAdmin(supabase, userId);
  const ledMinistryIds = new Set(await getLedMinistryIds(supabase, userId));
  if (!isDevTeam && ledMinistryIds.size === 0) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  const { data: rows } = await admin
    .from("staff_ministry_members")
    .select(
      `user_id, staff_ministry_id,
       ministry:staff_ministries!staff_ministry_id(id, name),
       user:users!user_id(id, first_name, last_name, display_name, email, health_insurance_expiry_date, status)`
    )
    .eq("status", "active");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = (rows ?? []) as any[];

  // One entry per person, keeping their most urgent membership.
  const byPerson = new Map<string, StaffInsuranceAlert>();

  for (const r of all) {
    const ministryId: string = r.staff_ministry_id;
    // Scope: dev team sees everyone; leaders only their led ministries.
    if (!isDevTeam && !ledMinistryIds.has(ministryId)) continue;
    if (r.user_id === userId) continue; // never alert someone about themselves
    // Skip deactivated/archived accounts.
    if (r.user?.status === "inactive" || r.user?.status === "archived") continue;

    const status = getInsuranceStatus({
      health_insurance_expiry_date: r.user?.health_insurance_expiry_date,
    });

    const include =
      status.state === "missing" ||
      status.state === "expired" ||
      (status.state === "expiring" &&
        (status.daysLeft ?? Number.POSITIVE_INFINITY) <= INSURANCE_LEADER_ALERT_DAYS);
    if (!include) continue;

    const alert: StaffInsuranceAlert = {
      userId: r.user_id,
      name: personName(r.user),
      ministryId,
      ministryName: r.ministry?.name ?? "Ministry",
      state: status.state as StaffInsuranceState,
      expiryDate: status.expiryDate,
      daysLeft: status.daysLeft,
    };

    const existing = byPerson.get(r.user_id);
    const moreUrgent =
      !existing ||
      urgencyRank(alert.state) < urgencyRank(existing.state) ||
      (urgencyRank(alert.state) === urgencyRank(existing.state) &&
        (alert.daysLeft ?? Number.POSITIVE_INFINITY) <
          (existing.daysLeft ?? Number.POSITIVE_INFINITY));
    if (moreUrgent) byPerson.set(r.user_id, alert);
  }

  return Array.from(byPerson.values()).sort((a, b) => {
    const byState = urgencyRank(a.state) - urgencyRank(b.state);
    if (byState !== 0) return byState;
    return (
      (a.daysLeft ?? Number.POSITIVE_INFINITY) -
      (b.daysLeft ?? Number.POSITIVE_INFINITY)
    );
  });
}
