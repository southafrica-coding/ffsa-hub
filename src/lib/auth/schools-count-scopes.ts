// Resolves, for a given user, which programs they may see application /
// enrolment counts for — and at what *level*. Level drives how much detail
// the dashboard card shows:
//   - "view":   headcount tiles only (Applications / Accepted / Enrolled)
//   - "manage": the above, plus the per-status breakdown
//
// This mirrors the direct-grant + admin-role model used by
// `userCanManageApplications` and `getSchoolsManageScopes`, rather than the
// RLS-derived role_permissions path — the same model our non-admin staff are
// provisioned through (direct user_permissions rows).

import type { SupabaseClient } from "@supabase/supabase-js";

export type CountLevel = "view" | "manage";

// Permission keys that grant *some* visibility into applications, mapped to
// the level they confer. Anything here that is a management/approval action
// unlocks the status breakdown; plain view only unlocks headcounts.
const KEY_LEVELS: Record<string, CountLevel> = {
  "schools.view_applications": "view",
  "schools.approve_applications": "manage",
  "schools.manage_enrollments": "manage",
  "schools.manage": "manage",
};

// Roles that see every program at manage level.
const GLOBAL_ROLES = ["super_admin", "admin", "program_leader"];

export type SchoolsCountScopes = {
  // Non-null when the user sees ALL programs (admin/leader role, or a global
  // unscoped grant). Carries the level that global access confers.
  globalLevel: CountLevel | null;
  // Per-program levels from program-scoped grants (in addition to any global).
  programLevels: Record<string, CountLevel>;
};

function higher(a: CountLevel | undefined, b: CountLevel): CountLevel {
  return a === "manage" || b === "manage" ? "manage" : "view";
}

export async function getSchoolsCountScopes(
  supabase: SupabaseClient,
  userId: string
): Promise<SchoolsCountScopes> {
  const [rolesResult, permsResult] = await Promise.all([
    supabase
      .from("user_roles")
      .select("roles!inner(name)")
      .eq("user_id", userId)
      .in("roles.name", GLOBAL_ROLES)
      .limit(1),
    supabase
      .from("user_permissions")
      .select("scope_id, scope_type, permissions!inner(key)")
      .eq("user_id", userId)
      .in("permissions.key", Object.keys(KEY_LEVELS)),
  ]);

  let globalLevel: CountLevel | null =
    rolesResult.data && rolesResult.data.length > 0 ? "manage" : null;
  const programLevels: Record<string, CountLevel> = {};

  for (const row of (permsResult.data ?? []) as Array<{
    scope_id: string | null;
    scope_type: string | null;
    permissions: { key: string } | { key: string }[];
  }>) {
    // supabase-js may return the joined row as an object or a single-element
    // array depending on the relationship inference — normalise both.
    const perm = Array.isArray(row.permissions)
      ? row.permissions[0]
      : row.permissions;
    const level = perm ? KEY_LEVELS[perm.key] : undefined;
    if (!level) continue;

    if (row.scope_id == null) {
      // Unscoped (global) grant of a schools key.
      globalLevel = higher(globalLevel ?? undefined, level);
    } else if (row.scope_type === "program") {
      programLevels[row.scope_id] = higher(programLevels[row.scope_id], level);
    }
  }

  return { globalLevel, programLevels };
}
