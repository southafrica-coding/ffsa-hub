// App-layer gate for the evangelism API.
//
// The module in src/config/modules.ts is admin-only and hidden. These keys
// do not exist in `permissions` yet — Hub Data seeds them. Until then only
// super_admin and admin pass, which matches the placeholder page.
//
//   evangelism.view     published stories, base stats, TV feed
//   evangelism.submit   upload a story (includes view)
//   evangelism.publish  publish / withhold / edit anyone's story (includes submit)
//
// Grants count whether they sit on the user or on a role bundle, same as
// prayer-room evaluator access.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export const EVANGELISM_VIEW = "evangelism.view";
export const EVANGELISM_SUBMIT = "evangelism.submit";
export const EVANGELISM_PUBLISH = "evangelism.publish";

const ALL_KEYS = [EVANGELISM_VIEW, EVANGELISM_SUBMIT, EVANGELISM_PUBLISH];

export type EvangelismAccess = {
  view: boolean;
  submit: boolean;
  publish: boolean;
};

const NONE: EvangelismAccess = { view: false, submit: false, publish: false };
const ALL: EvangelismAccess = { view: true, submit: true, publish: true };

function roleNames(rows: unknown): string[] {
  const list = Array.isArray(rows) ? rows : [];
  return list.flatMap((row) => {
    const roles = (row as { roles?: { name: string } | { name: string }[] | null }).roles;
    if (!roles) return [];
    return Array.isArray(roles) ? roles.map((r) => r.name) : [roles.name];
  });
}

function keysOf(rows: unknown): Set<string> {
  const list = Array.isArray(rows) ? rows : [];
  const keys = new Set<string>();
  for (const row of list) {
    const perm = (row as { permissions?: { key: string } | { key: string }[] }).permissions;
    const items = Array.isArray(perm) ? perm : perm ? [perm] : [];
    for (const item of items) if (item?.key) keys.add(item.key);
  }
  return keys;
}

function fromKeys(keys: Set<string>): EvangelismAccess {
  const publish = keys.has(EVANGELISM_PUBLISH);
  const submit = publish || keys.has(EVANGELISM_SUBMIT);
  const view = submit || keys.has(EVANGELISM_VIEW);
  return { view, submit, publish };
}

export async function getEvangelismAccess(supabase: Client, userId: string): Promise<EvangelismAccess> {
  const [{ data: roleRows }, { data: direct }] = await Promise.all([
    supabase.from("user_roles").select("role_id, roles(name)").eq("user_id", userId),
    supabase
      .from("user_permissions")
      .select("permissions!inner(key)")
      .eq("user_id", userId)
      .in("permissions.key", ALL_KEYS),
  ]);

  const names = roleNames(roleRows);
  if (names.includes("super_admin") || names.includes("admin")) return ALL;

  const directKeys = keysOf(direct);
  if (directKeys.size > 0) {
    // A direct grant is enough; still merge a bundle so a role can add a key
    // the user does not hold directly.
    const bundled = await bundleKeys(supabase, roleRows);
    return fromKeys(new Set([...directKeys, ...bundled]));
  }

  const bundled = await bundleKeys(supabase, roleRows);
  if (bundled.size === 0) return NONE;
  return fromKeys(bundled);
}

async function bundleKeys(supabase: Client, roleRows: unknown): Promise<Set<string>> {
  const roleIds = (Array.isArray(roleRows) ? roleRows : [])
    .map((row) => (row as { role_id?: string }).role_id)
    .filter((id): id is string => typeof id === "string");
  if (roleIds.length === 0) return new Set();
  const { data } = await supabase
    .from("role_permissions")
    .select("permissions!inner(key)")
    .in("role_id", roleIds)
    .in("permissions.key", ALL_KEYS);
  return keysOf(data);
}
