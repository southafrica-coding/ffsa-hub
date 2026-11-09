// Evangelism access for pages and route handlers.
//
// RLS (migration 307) is the real gate — every route writes with the
// caller's own client. This helper decides what UI to show and lets a
// route refuse with a clean 401/403 instead of an empty list or a raw
// PostgREST error.
//
//   evangelism.view     read published stories
//   evangelism.submit   + submit stories (includes view)
//   evangelism.publish  + review queue: publish / withhold (includes submit)
//
// super_admin and admin get all three without a key, same as is_admin()
// in the migration. Grants count whether they sit on the user directly or
// on an assigned role's bundle — the prayer-room evaluator pattern.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export const EVANGELISM_VIEW = "evangelism.view";
export const EVANGELISM_SUBMIT = "evangelism.submit";
export const EVANGELISM_PUBLISH = "evangelism.publish";
const ALL_KEYS = [EVANGELISM_VIEW, EVANGELISM_SUBMIT, EVANGELISM_PUBLISH];

export type EvangelismAccess = { view: boolean; submit: boolean; publish: boolean };

export const NO_EVANGELISM_ACCESS: EvangelismAccess = { view: false, submit: false, publish: false };
const FULL: EvangelismAccess = { view: true, submit: true, publish: true };

/** Expand held keys down the hierarchy: publish ⇒ submit ⇒ view. Pure. */
export function accessFromKeys(keys: Iterable<string>): EvangelismAccess {
  const held = new Set(keys);
  const publish = held.has(EVANGELISM_PUBLISH);
  const submit = publish || held.has(EVANGELISM_SUBMIT);
  const view = submit || held.has(EVANGELISM_VIEW);
  return { view, submit, publish };
}

function keysOf(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const perm = (row as { permissions?: { key?: string } | { key?: string }[] | null }).permissions;
    const list = Array.isArray(perm) ? perm : perm ? [perm] : [];
    return list.map((p) => p?.key).filter((k): k is string => typeof k === "string");
  });
}

export async function getEvangelismAccess(supabase: Client, userId: string): Promise<EvangelismAccess> {
  const [{ data: roleRows }, { data: direct }] = await Promise.all([
    supabase.from("user_roles").select("role_id, scope_type, roles(name)").eq("user_id", userId),
    supabase
      .from("user_permissions")
      .select("permissions!inner(key)")
      .eq("user_id", userId)
      .in("permissions.key", ALL_KEYS),
  ]);

  const roles = (Array.isArray(roleRows) ? roleRows : []) as Array<{
    role_id?: string;
    scope_type?: string | null;
    roles?: { name: string } | { name: string }[] | null;
  }>;
  // Only an UNSCOPED admin / super_admin counts, matching is_admin() in the
  // database. A program-scoped admin role must not unlock more here than
  // RLS will allow.
  const names = roles
    .filter((r) => r.scope_type == null)
    .flatMap((r) => (Array.isArray(r.roles) ? r.roles.map((x) => x.name) : r.roles ? [r.roles.name] : []));
  if (names.includes("super_admin") || names.includes("admin")) return FULL;

  const keys = keysOf(direct);
  // A direct publish grant already answers everything.
  if (keys.includes(EVANGELISM_PUBLISH)) return FULL;

  const roleIds = roles.map((r) => r.role_id).filter((id): id is string => typeof id === "string");
  if (roleIds.length > 0) {
    const { data: bundled } = await supabase
      .from("role_permissions")
      .select("permissions!inner(key)")
      .in("role_id", roleIds)
      .in("permissions.key", ALL_KEYS);
    keys.push(...keysOf(bundled));
  }
  return accessFromKeys(keys);
}
