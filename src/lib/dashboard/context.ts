// Everything the dashboard needs to decide, per user, which widgets are
// available (gate) and which are on by default. Computed once and threaded
// through the registry so each widget's gate/defaultEnabled is a cheap sync
// predicate over this object.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSchoolsCountScopes,
  type SchoolsCountScopes,
} from "@/lib/auth/schools-count-scopes";
import { callerIsAdmin, getLedMinistryIds } from "@/lib/auth/check-ministry-access";
import { isPrayerRoomStaff } from "@/lib/auth/prayer-room-access";
import { getVehicleAccess } from "@/services/vehicles";
import { hasModuleAccess } from "@/lib/require-permission";

export type DashboardContext = {
  // super_admin / admin — the "dev team" tier. Sees everything by default.
  isAdmin: boolean;
  userRoles: Set<string>;
  hasStaffRole: boolean;
  schools: SchoolsCountScopes;
  hasSchoolsAccess: boolean;
  ledMinistryIds: string[];
  isMinistryLeader: boolean;
  isPrayerRoomStaff: boolean;
  // canView is near-universal (self_service floor), so "is a vehicles person"
  // keys off manage/approve.
  isVehiclesPerson: boolean;
  // Space Bookings is NOT part of the baseline floor: migration 162 removed
  // bookings.view from self_service, leaving it to ministry leaders, booking
  // managers, leadership_team and admins. Same predicate the page guard uses,
  // so the dashboard cannot offer a module the page will refuse.
  hasBookingsAccess: boolean;
  // On the Legal → Documents access list (migration 371). Never a role:
  // super admins are not on it unless named.
  hasLegalAccess: boolean;
};

export async function buildDashboardContext(
  supabase: SupabaseClient,
  userId: string
): Promise<DashboardContext> {
  const [roleRows, isAdmin, schools, ledMinistryIds, prayer, vehicles, bookings, legal] =
    await Promise.all([
      supabase.from("user_roles").select("roles!inner(name)").eq("user_id", userId),
      callerIsAdmin(supabase, userId),
      getSchoolsCountScopes(supabase, userId),
      getLedMinistryIds(supabase, userId),
      isPrayerRoomStaff(supabase, userId),
      getVehicleAccess(supabase, userId),
      hasModuleAccess(supabase, userId, "bookings"),
      // Best-effort: before migration 371 the function doesn't exist.
      Promise.resolve()
        .then(() => supabase.rpc("legal_any_access"))
        .then((r) => !r.error && r.data === true)
        .catch(() => false),
    ]);

  const userRoles = new Set<string>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((roleRows.data ?? []) as any[]).flatMap((r) => {
      const roles = r.roles;
      return Array.isArray(roles)
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          roles.map((x: any) => x.name)
        : roles
        ? [roles.name]
        : [];
    })
  );

  const hasSchoolsAccess =
    schools.globalLevel !== null || Object.keys(schools.programLevels).length > 0;
  const isVehiclesPerson = !!(vehicles?.canManage || vehicles?.canApprove);

  return {
    isAdmin,
    userRoles,
    hasStaffRole: userRoles.has("staff"),
    schools,
    hasSchoolsAccess,
    ledMinistryIds,
    isMinistryLeader: ledMinistryIds.length > 0,
    isPrayerRoomStaff: prayer,
    isVehiclesPerson,
    hasBookingsAccess: bookings,
    hasLegalAccess: legal,
  };
}
