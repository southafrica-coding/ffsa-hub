// Scope-aware events.* checks. Mirrors has_event_permission from migration
// 314 (PR #543, head 79a39775) without requiring that function to exist.
//
// Mirrored SQL, supabase/migrations/314_event_scoped_permissions.sql on
// feat/event-scoped-permissions-314:
//   has_event_permission body: lines 54–103
//     55–57  users.is_active IS NOT FALSE
//     59–67  user_permissions, exact key, scope NULL or event+id
//     68–77  the same via user_roles → role_permissions
//     78–102 creator arm: events.created_by = caller AND the key is held
//            with scope_type = 'event' on any event, either path
//   NULL target_event_id: the scope_id comparisons are unknown, and the
//   creator EXISTS fails, so only an unscoped grant remains (comment line 107).
//
// The function has no role bypass. Those sit on the policies:
//   is_admin() — migration 002 lines 71–80, unscoped admin or super_admin
//   has_role(name) — migration 002 lines 23–51, one argument counts only
//   scope_type IS NULL
//   events UPDATE also allows created_by = caller with no key (lines 160–163)
//   events INSERT: is_admin, events_admin, unscoped events.create, or
//   created_by = self with events.create in any scope (line 157, via
//   has_permission, which is not scope-filtered)
//
// Role bypasses do not consult is_active. is_admin() and has_role() in
// 002 do not, and 313 did not change them. Grant arms do.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type EventGrant = {
  key: string;
  /** null = unscoped. Anything other than null or 'event' never counts. */
  scopeType: string | null;
  scopeId: string | null;
  via: "direct" | "role";
};

export type EventRole = {
  roleId: string;
  name: string;
  scopeType: string | null;
  scopeId: string | null;
};

export type EventAccessSnapshot = {
  /** True when users.is_active IS NOT FALSE. No row → false. */
  active: boolean;
  roles: EventRole[];
  grants: EventGrant[];
};

export type EventGate = {
  /** Exact permission keys. Any one is enough. No wildcards. */
  keys: readonly string[];
  /**
   * Unscoped roles that bypass the key for this table, besides
   * admin / super_admin (always applied, matching is_admin()).
   */
  bypassRoles?: readonly string[];
  /**
   * events UPDATE only: created_by = caller is enough, with no key.
   * The creator arm inside has_event_permission is separate and always
   * evaluated for the key.
   */
  allowCreator?: boolean;
};

// ── Gates, one per 314 policy family ───────────────────────

/** events UPDATE (lines 160–163). */
export const EVENT_UPDATE_GATE: EventGate = {
  keys: ["events.create"],
  bypassRoles: ["events_admin"],
  allowCreator: true,
};

/** Child tables managed with events.create + events_admin. */
export const EVENT_CREATE_GATE: EventGate = {
  keys: ["events.create"],
  bypassRoles: ["events_admin"],
};

/** Reads that accept view OR create (labels, feedback). */
export const EVENT_VIEW_OR_CREATE_GATE: EventGate = {
  keys: ["events.view", "events.create"],
  bypassRoles: ["events_admin"],
};

/** Registrations write. No finance_admin (lines 171–184). */
export const REGISTRATIONS_GATE: EventGate = {
  keys: ["events.manage_registrations"],
  bypassRoles: ["events_admin"],
};

/** Orders and order_refunds manage (lines 187–201). */
export const ORDERS_GATE: EventGate = {
  keys: ["events.manage_registrations"],
  bypassRoles: ["events_admin", "finance_admin"],
};

/** Tickets manage / door check-in (lines 209–212). */
export const ATTENDANCE_GATE: EventGate = {
  keys: ["events.manage_attendance"],
  bypassRoles: ["events_admin"],
};

/**
 * Scan links (lines 276–279). is_admin, or manage_attendance, or
 * events.manage. No events_admin arm.
 */
export const SCAN_LINK_GATE: EventGate = {
  keys: ["events.manage_attendance", "events.manage"],
  bypassRoles: [],
};

/** Outcomes, responses, workflows (lines 243–258). */
export const OUTCOMES_GATE: EventGate = {
  keys: ["events.create"],
  bypassRoles: ["events_admin", "comms_admin"],
};

/** Forms tied to an event (lines 318–321). No events_admin arm. */
export const FORMS_GATE: EventGate = {
  keys: ["events.create"],
  bypassRoles: ["comms_admin"],
};

/** Form reads tied to an event (lines 313–315, 329–331). */
export const FORMS_READ_GATE: EventGate = {
  keys: ["events.view", "events.create"],
  bypassRoles: ["comms_admin"],
};

const ADMIN_ROLES = ["admin", "super_admin"];

function normId(id: string | null | undefined): string | null {
  if (id == null) return null;
  const s = String(id).trim();
  return s ? s.toLowerCase() : null;
}

function sameId(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normId(a);
  const right = normId(b);
  return left != null && left === right;
}

/** is_admin(): unscoped admin or super_admin. Scoped assignments do not count. */
export function isUnscopedAdmin(snap: EventAccessSnapshot): boolean {
  return snap.roles.some(
    (r) => ADMIN_ROLES.includes(r.name) && r.scopeType == null
  );
}

/** has_role(name) with one argument: scope_type IS NULL only. */
export function hasUnscopedRole(snap: EventAccessSnapshot, names: readonly string[]): boolean {
  if (names.length === 0) return false;
  return snap.roles.some((r) => names.includes(r.name) && r.scopeType == null);
}

function grantsFor(snap: EventAccessSnapshot, key: string): EventGrant[] {
  return snap.grants.filter((g) => g.key === key);
}

/**
 * Pure mirror of has_event_permission. No role bypass.
 * eventId null → unscoped grants only.
 */
export function hasEventPermission(
  snap: EventAccessSnapshot,
  key: string,
  eventId: string | null,
  opts?: { createdByCaller?: boolean }
): boolean {
  if (!snap.active) return false;
  const grants = grantsFor(snap, key);
  if (grants.some((g) => g.scopeType == null)) return true;
  const target = normId(eventId);
  if (!target) return false;
  if (grants.some((g) => g.scopeType === "event" && sameId(g.scopeId, target))) return true;
  if (opts?.createdByCaller && grants.some((g) => g.scopeType === "event")) return true;
  return false;
}

export function allowsEventGate(
  snap: EventAccessSnapshot,
  gate: EventGate,
  eventId: string | null,
  opts?: { createdByCaller?: boolean }
): boolean {
  if (isUnscopedAdmin(snap)) return true;
  if (hasUnscopedRole(snap, gate.bypassRoles ?? [])) return true;
  if (gate.allowCreator && opts?.createdByCaller && normId(eventId)) return true;
  return gate.keys.some((key) => hasEventPermission(snap, key, eventId, opts));
}

/** events INSERT (314 line 157). */
export function canInsertEvent(snap: EventAccessSnapshot, asSelf: boolean): boolean {
  if (isUnscopedAdmin(snap) || hasUnscopedRole(snap, ["events_admin"])) return true;
  if (!snap.active) return false;
  const grants = grantsFor(snap, "events.create");
  if (grants.some((g) => g.scopeType == null)) return true;
  return asSelf && grants.length > 0;
}

/**
 * finance_org_choices / payment_fee_profiles: unchanged. The key in any
 * scope counts, plus the global admin / events_admin arms. Not the 314
 * helper — those policies were left on the old "any scope" reading.
 */
export function holdsKeyInAnyScope(snap: EventAccessSnapshot, key: string): boolean {
  if (isUnscopedAdmin(snap) || hasUnscopedRole(snap, ["events_admin"])) return true;
  if (!snap.active) return false;
  return snap.grants.some((g) => g.key === key);
}

export type EventIdScope =
  | { kind: "all" }
  | { kind: "some"; ids: string[]; includeCreated: boolean };

/** Events a caller may run for a list, before any service-role read. */
export function eventIdScope(snap: EventAccessSnapshot, gate: EventGate): EventIdScope {
  if (isUnscopedAdmin(snap) || hasUnscopedRole(snap, gate.bypassRoles ?? [])) {
    return { kind: "all" };
  }
  if (!snap.active) return { kind: "some", ids: [], includeCreated: false };
  const ids = new Set<string>();
  let includeCreated = false;
  for (const key of gate.keys) {
    for (const g of grantsFor(snap, key)) {
      if (g.scopeType == null) return { kind: "all" };
      if (g.scopeType === "event" && g.scopeId) {
        ids.add(normId(g.scopeId) as string);
        includeCreated = true;
      }
    }
  }
  return { kind: "some", ids: [...ids], includeCreated };
}

export type EventUiCapabilities = {
  edit: boolean;
  refund: boolean;
  checkIn: boolean;
  scanLink: boolean;
  outcomes: boolean;
  forms: boolean;
};

export function capabilitiesFrom(
  snap: EventAccessSnapshot,
  eventId: string,
  createdBy: string | null,
  userId: string
): EventUiCapabilities {
  const createdByCaller = sameId(createdBy, userId);
  const allow = (gate: EventGate) => allowsEventGate(snap, gate, eventId, { createdByCaller });
  return {
    edit: allow(EVENT_UPDATE_GATE),
    refund: allow(ORDERS_GATE),
    checkIn: allow(ATTENDANCE_GATE),
    scanLink: allow(SCAN_LINK_GATE),
    outcomes: allow(OUTCOMES_GATE),
    forms: allow(FORMS_GATE),
  };
}

// ── Loading ────────────────────────────────────────────────

function relKey(permissions: unknown): string | null {
  if (!permissions) return null;
  if (Array.isArray(permissions)) {
    const first = permissions[0] as { key?: string } | undefined;
    return first?.key ?? null;
  }
  const key = (permissions as { key?: string }).key;
  return key ?? null;
}

export async function loadEventAccess(supabase: Client, userId: string): Promise<EventAccessSnapshot> {
  const [userRes, rolesRes, directRes] = await Promise.all([
    supabase.from("users").select("is_active").eq("id", userId).maybeSingle(),
    supabase
      .from("user_roles")
      .select("role_id, scope_type, scope_id, roles!inner(name)")
      .eq("user_id", userId),
    supabase
      .from("user_permissions")
      .select("scope_type, scope_id, permissions!inner(key)")
      .eq("user_id", userId),
  ]);

  const active = !!userRes.data && userRes.data.is_active !== false;

  const roles: EventRole[] = ((rolesRes.data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      roleId: String(row.role_id),
      name: roleName(row.roles),
      scopeType: (row.scope_type as string | null) ?? null,
      scopeId: (row.scope_id as string | null) ?? null,
    }))
    .filter((r) => r.name);

  // relKey on roles reads .key, but roles have .name. Fix below.
  const grants: EventGrant[] = [];
  for (const row of (directRes.data ?? []) as Array<Record<string, unknown>>) {
    const key = relKey(row.permissions);
    if (!key) continue;
    grants.push({
      key,
      scopeType: (row.scope_type as string | null) ?? null,
      scopeId: (row.scope_id as string | null) ?? null,
      via: "direct",
    });
  }

  const roleIds = [...new Set(roles.map((r) => r.roleId))];
  if (roleIds.length > 0) {
    const { data: bundles } = await supabase
      .from("role_permissions")
      .select("role_id, permissions!inner(key)")
      .in("role_id", roleIds);
    const byRole = new Map<string, string[]>();
    for (const row of (bundles ?? []) as Array<Record<string, unknown>>) {
      const key = relKey(row.permissions);
      if (!key) continue;
      const id = String(row.role_id);
      const list = byRole.get(id) ?? [];
      list.push(key);
      byRole.set(id, list);
    }
    for (const role of roles) {
      for (const key of byRole.get(role.roleId) ?? []) {
        grants.push({
          key,
          scopeType: role.scopeType,
          scopeId: role.scopeId,
          via: "role",
        });
      }
    }
  }

  return { active, roles, grants };
}

// Fix role name extraction: roles!inner(name) returns { name }, not { key }.
function roleName(roles: unknown): string {
  if (!roles) return "";
  if (Array.isArray(roles)) return String((roles[0] as { name?: string } | undefined)?.name ?? "");
  return String((roles as { name?: string }).name ?? "");
}

// ── RPC, then the TS mirror ────────────────────────────────

let rpcUnavailable = false;

/** Tests reset the "function is not on this database" cache. */
export function resetEventPermissionRpcCache(): void {
  rpcUnavailable = false;
}

function rpcMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = error.message ?? "";
  if (code === "PGRST202" || code === "42883") return true;
  return /has_event_permission/i.test(msg) && /schema cache|does not exist|could not find/i.test(msg);
}

/**
 * True / false when the 314 function answered. "fallback" when it is
 * missing, the result is not a boolean, or the call errored — the TS
 * mirror decides, and it stays strict.
 */
async function rpcHasEventPermission(
  supabase: Client,
  key: string,
  eventId: string | null
): Promise<boolean | "fallback"> {
  if (rpcUnavailable) return "fallback";
  const { data, error } = await supabase.rpc("has_event_permission", {
    required_permission: key,
    target_event_id: eventId,
  });
  if (error) {
    if (rpcMissing(error)) rpcUnavailable = true;
    return "fallback";
  }
  if (data === true || data === false) return data;
  return "fallback";
}

async function callerCreated(supabase: Client, userId: string, eventId: string | null): Promise<boolean> {
  if (!eventId) return false;
  const { data } = await supabase.from("events").select("created_by").eq("id", eventId).maybeSingle();
  return sameId(data?.created_by, userId);
}

/**
 * canManageEvent(user, key, eventId) — the client is first because every
 * helper in this codebase is handed a Supabase client.
 *
 * Role bypass for the gate is applied here. The permission arm tries
 * has_event_permission and, until that function exists, the TS mirror.
 */
export async function canManageEvent(
  supabase: Client,
  userId: string,
  key: string | readonly string[],
  eventId: string | null,
  options?: { bypassRoles?: readonly string[]; allowCreator?: boolean }
): Promise<boolean> {
  const gate: EventGate = {
    keys: typeof key === "string" ? [key] : key,
    bypassRoles: options?.bypassRoles,
    allowCreator: options?.allowCreator,
  };
  const snap = await loadEventAccess(supabase, userId);
  if (isUnscopedAdmin(snap) || hasUnscopedRole(snap, gate.bypassRoles ?? [])) return true;

  const createdByCaller = await callerCreated(supabase, userId, eventId);
  if (gate.allowCreator && createdByCaller && normId(eventId)) return true;

  let sawFalse = false;
  for (const required of gate.keys) {
    const rpc = await rpcHasEventPermission(supabase, required, eventId);
    if (rpc === true) return true;
    if (rpc === false) sawFalse = true;
    else return gate.keys.some((k) => hasEventPermission(snap, k, eventId, { createdByCaller }));
  }
  return sawFalse ? false : false;
}

export async function canHoldEventsKeyInAnyScope(
  supabase: Client,
  userId: string,
  key = "events.create"
): Promise<boolean> {
  const snap = await loadEventAccess(supabase, userId);
  return holdsKeyInAnyScope(snap, key);
}

export async function userCanInsertEvent(supabase: Client, userId: string): Promise<boolean> {
  const snap = await loadEventAccess(supabase, userId);
  return canInsertEvent(snap, true);
}

export async function loadEventCapabilities(
  supabase: Client,
  userId: string,
  eventId: string,
  createdBy: string | null
): Promise<EventUiCapabilities> {
  const snap = await loadEventAccess(supabase, userId);
  return capabilitiesFrom(snap, eventId, createdBy, userId);
}

/** A 0-row write, or a PostgREST / RLS denial, is not a successful update. */
export function writeBlocked(
  error: { code?: string; message?: string } | null | undefined,
  data?: unknown
): boolean {
  if (error) {
    const code = error.code ?? "";
    const msg = error.message ?? "";
    if (code === "42501" || code === "PGRST116") return true;
    if (/row-level security|permission denied/i.test(msg)) return true;
    return false;
  }
  return Array.isArray(data) && data.length === 0;
}

export async function readEventId(
  supabase: Client,
  table: string,
  id: string
): Promise<string | null> {
  const { data } = await supabase.from(table).select("event_id").eq("id", id).maybeSingle();
  return (data?.event_id as string | null) ?? null;
}

/**
 * The order's event, from the database. A client-supplied event id is never
 * the answer. When the caller's RLS hides the row, a service-role read of
 * the id alone distinguishes "out of scope" (403) from "no such order" (404).
 * It does not refund, email, or talk to a payment provider.
 */
export async function resolveOrderEventId(
  supabase: Client,
  orderId: string
): Promise<{ eventId: string } | { status: 403 | 404 }> {
  const { data, error } = await supabase
    .from("orders")
    .select("id, event_id")
    .eq("id", orderId)
    .maybeSingle();
  if (data?.event_id) return { eventId: data.event_id as string };
  if (error && writeBlocked(error, null)) return { status: 403 };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const probe = await admin.from("orders").select("id").eq("id", orderId).maybeSingle();
  if (probe.data?.id) return { status: 403 };
  return { status: 404 };
}
