// ────────────────────────────────────────────────────────────
// GET /api/me: who the caller is and what they may do
// ────────────────────────────────────────────────────────────
// Pure shaping of the rows read in src/services/me.ts. The phone app
// depends on this JSON shape exactly; change it only with the app.
//
// Permissions come from the same two places SQL has_permission() /
// has_permission_for() look (migration 089), so the app and RLS agree:
//   - direct:  user_permissions -> permissions             (scope from the grant)
//   - role:    user_roles -> role_permissions -> permissions (scope from the role
//              assignment, exactly as has_permission_for reads it)
// ────────────────────────────────────────────────────────────

export type MeRole = { name: string; scopeType: string | null; scopeId: string | null };

export type MePermission = {
  key: string;
  scopeType: string | null;
  scopeId: string | null;
  source: "direct" | "role";
};

export type MePayload = {
  user: { id: string; email: string | null };
  profile: {
    firstName: string | null;
    lastName: string | null;
    preferredName: string | null;
    avatarUrl: string | null;
    isActive: boolean;
  };
  roles: MeRole[];
  permissions: MePermission[];
  serverTime: string;
};

// PostgREST returns an embedded to-one relation as an object, but the
// generated types (and some joins) say array; accept both.
type Embedded<T> = T | T[] | null;

export type RoleAssignmentRow = {
  role_id: string;
  scope_type: string | null;
  scope_id: string | null;
  roles: Embedded<{ name: string }>;
};

export type DirectPermissionRow = {
  scope_type: string | null;
  scope_id: string | null;
  permissions: Embedded<{ key: string }>;
};

export type RoleBundleRow = {
  role_id: string;
  permissions: Embedded<{ key: string }>;
};

export type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  avatar_url: string | null;
  is_active: boolean | null;
};

function one<T>(value: Embedded<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const scopeKey = (key: string, scopeType: string | null, scopeId: string | null) =>
  `${key}\u0000${scopeType ?? ""}\u0000${scopeId ?? ""}`;

function byKeyThenScope<T extends { scopeType: string | null; scopeId: string | null }>(
  name: (x: T) => string
) {
  return (a: T, b: T) =>
    name(a).localeCompare(name(b)) ||
    (a.scopeType ?? "").localeCompare(b.scopeType ?? "") ||
    (a.scopeId ?? "").localeCompare(b.scopeId ?? "");
}

/** The caller's role assignments, one per (role, scope), sorted. */
export function listRoles(assignments: RoleAssignmentRow[]): MeRole[] {
  const seen = new Map<string, MeRole>();
  for (const a of assignments) {
    const name = one(a.roles)?.name;
    if (!name) continue;
    const k = scopeKey(name, a.scope_type, a.scope_id);
    if (!seen.has(k)) seen.set(k, { name, scopeType: a.scope_type, scopeId: a.scope_id });
  }
  return [...seen.values()].sort(byKeyThenScope<MeRole>((r) => r.name));
}

/**
 * Direct grants plus role-bundle grants, de-duplicated on (key, scope).
 * A role grant takes the scope of the role ASSIGNMENT (a program_leader
 * assigned to program A holds that bundle for program A only). When the same
 * (key, scope) arrives both ways, it is reported once, as "direct".
 */
export function mergePermissions(
  direct: DirectPermissionRow[],
  assignments: RoleAssignmentRow[],
  bundles: RoleBundleRow[]
): MePermission[] {
  const out = new Map<string, MePermission>();

  for (const d of direct) {
    const key = one(d.permissions)?.key;
    if (!key) continue;
    out.set(scopeKey(key, d.scope_type, d.scope_id), {
      key,
      scopeType: d.scope_type,
      scopeId: d.scope_id,
      source: "direct",
    });
  }

  const keysByRole = new Map<string, string[]>();
  for (const b of bundles) {
    const key = one(b.permissions)?.key;
    if (!key) continue;
    keysByRole.set(b.role_id, [...(keysByRole.get(b.role_id) ?? []), key]);
  }

  for (const a of assignments) {
    for (const key of keysByRole.get(a.role_id) ?? []) {
      const k = scopeKey(key, a.scope_type, a.scope_id);
      if (out.has(k)) continue;
      out.set(k, { key, scopeType: a.scope_type, scopeId: a.scope_id, source: "role" });
    }
  }

  return [...out.values()].sort(byKeyThenScope<MePermission>((p) => p.key));
}

export function buildMePayload(input: {
  user: { id: string; email?: string | null };
  profile: ProfileRow | null;
  assignments: RoleAssignmentRow[];
  direct: DirectPermissionRow[];
  bundles: RoleBundleRow[];
  now: Date;
}): MePayload {
  const p = input.profile;
  return {
    user: { id: input.user.id, email: input.user.email ?? null },
    profile: {
      firstName: p?.first_name ?? null,
      lastName: p?.last_name ?? null,
      preferredName: p?.preferred_name ?? null,
      avatarUrl: p?.avatar_url ?? null,
      // Same rule as the middleware: only an explicit false is deactivated.
      isActive: p?.is_active !== false,
    },
    roles: listRoles(input.assignments),
    permissions: mergePermissions(input.direct, input.assignments, input.bundles),
    serverTime: input.now.toISOString(),
  };
}
