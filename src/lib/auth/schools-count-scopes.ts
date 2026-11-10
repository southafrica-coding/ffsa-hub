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

// Roles that see every program at manage level, whatever scope the row
// carries. program_leader is not one of them (migration 312): an unscoped
// assignment is global, a program scope counts for that program only, and
// a team or event scope grants nothing.
const GLOBAL_ROLES = ["super_admin", "admin"];
const SCOPED_COUNT_ROLES = [...GLOBAL_ROLES, "program_leader"];

export type SchoolsCountScopes = {
  // Non-null when the user sees ALL programs (unscoped admin/super_admin,
  // unscoped program_leader, or an unscoped grant).
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
      .select("scope_type, scope_id, roles!inner(name)")
      .eq("user_id", userId)
      .in("roles.name", SCOPED_COUNT_ROLES),
    supabase
      .from("user_permissions")
      .select("scope_id, scope_type, permissions!inner(key)")
      .eq("user_id", userId)
      .in("permissions.key", Object.keys(KEY_LEVELS)),
  ]);

  let globalLevel: CountLevel | null = null;
  const programLevels: Record<string, CountLevel> = {};

  for (const row of (rolesResult.data ?? []) as Array<{
    scope_type: string | null;
    scope_id: string | null;
    roles: { name: string } | { name: string }[] | null;
  }>) {
    const roles = row.roles;
    const name = Array.isArray(roles) ? roles[0]?.name : roles?.name;
    if (name && GLOBAL_ROLES.includes(name)) {
      globalLevel = "manage";
      continue;
    }
    if (name !== "program_leader") continue;
    // scope_type IS NULL, or scope_type = 'program' AND scope_id = that program.
    if (row.scope_type === null) {
      globalLevel = "manage";
    } else if (row.scope_type === "program" && row.scope_id) {
      programLevels[row.scope_id] = higher(programLevels[row.scope_id], "manage");
    }
  }

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
