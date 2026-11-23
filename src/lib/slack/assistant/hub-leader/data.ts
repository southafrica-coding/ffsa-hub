/**
 * Data access for the "Hub" Slack assistant (ministry leaders).
 *
 * Every read and write the assistant makes goes through here, with the
 * service-role client: the bot has no logged-in user, so who may see or
 * change what is decided in rules.ts, not by RLS. Keeping the queries in
 * one module also lets the tests swap them out wholesale.
 */

import { getLedMinistryIds } from "@/lib/auth/check-ministry-access";
import { callerIsAdmin, getEffectivePermissionKeys } from "@/lib/auth/check-role-grant";
import { userHasPassword } from "@/lib/auth/account-state";
import { getRoleDerivedPermissionRows, getUserPermissions, grantPermission, revokePermission } from "@/services/permissions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ────────────────────────────────────────────────────────────
// Ministries and members
// ────────────────────────────────────────────────────────────

export type Ministry = { id: string; name: string };

export type TeamMember = {
  user_id: string;
  ministry_id: string;
  ministry_name: string;
  member_role: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

/** Ministries the user actively leads (an active `leader` membership). */
export async function getLedMinistries(admin: Client, userId: string): Promise<Ministry[]> {
  const ids = await getLedMinistryIds(admin, userId);
  if (ids.length === 0) return [];
  const { data } = await admin.from("staff_ministries").select("id, name").in("id", ids).order("name");
  const named = new Map(((data ?? []) as Ministry[]).map((m) => [m.id, m.name]));
  return ids.map((id) => ({ id, name: named.get(id) ?? "Ministry" }));
}

/**
 * Ministries where the user is an active point leader: the ministry's own
 * point leader (`is_point_leader`) or a category point leader
 * (`is_category_point_leader`, kept in step with
 * staff_ministry_member_subcategories by the 205 trigger). The same flags
 * lib/users/derive-title reads for "{Dept} Point Leader".
 */
export async function getPointLeaderMinistries(admin: Client, userId: string): Promise<Ministry[]> {
  const { data } = await admin
    .from("staff_ministry_members")
    .select("staff_ministry_id, staff_ministries!inner(name)")
    .eq("user_id", userId)
    .eq("status", "active")
    .or("is_point_leader.eq.true,is_category_point_leader.eq.true");
  type Row = { staff_ministry_id: string; staff_ministries: { name: string } | { name: string }[] | null };
  return ((data ?? []) as Row[]).map((r) => {
    const m = Array.isArray(r.staff_ministries) ? r.staff_ministries[0] : r.staff_ministries;
    return { id: r.staff_ministry_id, name: m?.name ?? "Ministry" };
  });
}

/** Active members (leaders included) of these ministries. One row per membership. */
export async function getTeamMembers(admin: Client, ministryIds: string[]): Promise<TeamMember[]> {
  if (ministryIds.length === 0) return [];
  const { data } = await admin
    .from("staff_ministry_members")
    .select(
      "user_id, member_role, staff_ministry_id, staff_ministries!inner(name), user:users!user_id(first_name, last_name, email, is_active)"
    )
    .in("staff_ministry_id", ministryIds)
    .eq("status", "active");
  type Row = {
    user_id: string;
    member_role: string;
    staff_ministry_id: string;
    staff_ministries: { name: string } | { name: string }[] | null;
    user:
      | { first_name: string | null; last_name: string | null; email: string | null; is_active: boolean }
      | { first_name: string | null; last_name: string | null; email: string | null; is_active: boolean }[]
      | null;
  };
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const out: TeamMember[] = [];
  for (const r of (data ?? []) as Row[]) {
    const u = one(r.user);
    if (!u || u.is_active === false) continue;
    out.push({
      user_id: r.user_id,
      ministry_id: r.staff_ministry_id,
      ministry_name: one(r.staff_ministries)?.name ?? "Ministry",
      member_role: r.member_role,
      first_name: u.first_name,
      last_name: u.last_name,
      email: u.email,
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// Permissions
// ────────────────────────────────────────────────────────────

export type PermissionRow = { id: string; key: string; display_name: string; module: string };

export type DirectGrant = {
  permission_id: string;
  key: string;
  display_name: string;
  scope_type: string | null;
  scope_id: string | null;
};

export async function getPermissionByKey(admin: Client, key: string): Promise<PermissionRow | null> {
  const { data } = await admin
    .from("permissions")
    .select("id, key, display_name, module")
    .eq("key", key)
    .maybeSingle();
  return (data as PermissionRow | null) ?? null;
}

/** user_permissions rows (each with its scope). */
export async function getDirectGrants(admin: Client, userId: string): Promise<DirectGrant[]> {
  const rows = await getUserPermissions(admin, userId);
  return rows
    .filter((r) => r.permissions)
    .map((r) => ({
      permission_id: r.permission_id,
      key: r.permissions.key,
      display_name: r.permissions.display_name,
      scope_type: r.scope_type,
      scope_id: r.scope_id,
    }));
}

/** Keys that come from the user's roles (always unscoped). */
export async function getRoleKeys(admin: Client, userId: string): Promise<Set<string>> {
  const rows = await getRoleDerivedPermissionRows(admin, userId);
  return new Set(rows.map((r) => r.key));
}

/** Direct + role-derived keys (lib/auth/check-role-grant). */
export function getEffectiveKeys(admin: Client, userId: string): Promise<Set<string>> {
  return getEffectivePermissionKeys(admin, userId);
}

export async function getRoleNames(admin: Client, userId: string): Promise<string[]> {
  const { data } = await admin.from("user_roles").select("roles!inner(name)").eq("user_id", userId);
  type Row = { roles: { name: string } | { name: string }[] };
  return ((data ?? []) as Row[])
    .map((r) => (Array.isArray(r.roles) ? r.roles[0]?.name : r.roles?.name))
    .filter((n): n is string => Boolean(n));
}

/** super_admin or admin. */
export function isAdminTier(admin: Client, userId: string): Promise<boolean> {
  return callerIsAdmin(admin, userId);
}

/** Readable names for scope ids (programs, outreach teams, events). */
export async function getScopeLabels(admin: Client, scopes: { scope_type: string; scope_id: string }[]) {
  const labels = new Map<string, string>();
  const byType: Record<string, { table: string; col: string }> = {
    program: { table: "programs", col: "name" },
    team: { table: "outreach_teams", col: "name" },
    event: { table: "events", col: "title" },
  };
  for (const [type, src] of Object.entries(byType)) {
    const ids = [...new Set(scopes.filter((s) => s.scope_type === type).map((s) => s.scope_id))];
    if (ids.length === 0) continue;
    const { data } = await admin.from(src.table).select(`id, ${src.col}`).in("id", ids);
    for (const row of (data ?? []) as Record<string, string>[]) labels.set(`${type}:${row.id}`, row[src.col]);
  }
  return labels;
}

export function applyGrant(admin: Client, a: { userId: string; permissionId: string; grantedBy: string; scopeType: string | null; scopeId: string | null }) {
  return grantPermission(admin, a.userId, a.permissionId, a.grantedBy, a.scopeType ?? undefined, a.scopeId ?? undefined);
}

export function applyRevoke(admin: Client, a: { userId: string; permissionId: string; scopeType: string | null; scopeId: string | null }) {
  return revokePermission(admin, a.userId, a.permissionId, a.scopeType ?? undefined, a.scopeId ?? undefined);
}

// ────────────────────────────────────────────────────────────
// Invites
// ────────────────────────────────────────────────────────────

export async function getInviteTarget(
  admin: Client,
  userId: string
): Promise<{ id: string; email: string | null; first_name: string | null } | null> {
  const { data } = await admin.from("users").select("id, email, first_name").eq("id", userId).maybeSingle();
  return (data as { id: string; email: string | null; first_name: string | null } | null) ?? null;
}

export function hasPassword(admin: Client, userId: string): Promise<boolean> {
  return userHasPassword(admin, userId);
}

// ────────────────────────────────────────────────────────────
// Pending actions (migration 392)
// ────────────────────────────────────────────────────────────

export type PendingActionType =
  | "grant_permission"
  | "revoke_permission"
  | "resend_invite"
  // migration 393
  | "create_vehicle_booking"
  | "update_contact"
  | "decide_vehicle_booking"
  | "decide_space_booking";

export type PendingRow = {
  id: string;
  leader_hub_user_id: string;
  slack_user_id: string;
  action_type: PendingActionType;
  payload: Record<string, unknown>;
  expires_at: string;
  consumed_at: string | null;
  cancelled_at: string | null;
};

export const PENDING_TTL_MS = 10 * 60 * 1000;

export async function insertPending(
  admin: Client,
  row: { leader_hub_user_id: string; slack_user_id: string; slack_channel_id: string; action_type: PendingActionType; payload: Record<string, unknown> }
): Promise<string | null> {
  const { data, error } = await admin
    .from("slack_assistant_pending_actions")
    .insert({ ...row, expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString() })
    .select("id")
    .single();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

export async function getPending(admin: Client, id: string): Promise<PendingRow | null> {
  const { data } = await admin
    .from("slack_assistant_pending_actions")
    .select("id, leader_hub_user_id, slack_user_id, action_type, payload, expires_at, consumed_at, cancelled_at")
    .eq("id", id)
    .maybeSingle();
  return (data as PendingRow | null) ?? null;
}

/**
 * Close a pending action, but only if it is still open and unexpired.
 * The conditional update is what stops a double click or a replayed
 * button from running the change twice: only one caller gets the row.
 */
export async function claimPending(
  admin: Client,
  id: string,
  how: "consumed" | "cancelled",
  result: string
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data } = await admin
    .from("slack_assistant_pending_actions")
    .update({ [how === "consumed" ? "consumed_at" : "cancelled_at"]: now, result })
    .eq("id", id)
    .is("consumed_at", null)
    .is("cancelled_at", null)
    .gt("expires_at", now)
    .select("id")
    .maybeSingle();
  return Boolean(data);
}

export async function setPendingResult(admin: Client, id: string, result: string) {
  await admin.from("slack_assistant_pending_actions").update({ result }).eq("id", id);
}

// ────────────────────────────────────────────────────────────
// Tickets and audit (migration 392 + audit_logs)
// ────────────────────────────────────────────────────────────

/**
 * `evidence` needs migration 393. If that column isn't there yet the
 * report is still filed, without it (the caller has put the gist in the
 * message as well).
 */
export async function insertTicket(
  admin: Client,
  row: {
    reporter_hub_user_id: string;
    slack_user_id: string;
    ministry_ids: string[];
    ministry_names: string[];
    message: string;
    evidence?: Record<string, unknown> | null;
  }
): Promise<string | null> {
  const insert = (r: Record<string, unknown>) =>
    admin.from("slack_assistant_tickets").insert({ ...r, status: "open" }).select("id").single();
  let { data, error } = await insert(row);
  if (error && row.evidence !== undefined) {
    const { evidence: _e, ...rest } = row; // eslint-disable-line @typescript-eslint/no-unused-vars
    ({ data, error } = await insert(rest));
  }
  if (error || !data) return null;
  return (data as { id: string }).id;
}

export type AuditResult = "executed" | "refused" | "failed" | "cancelled" | "proposed";

/** One row in slack_assistant_audit_log. Never throws: auditing must not break a reply. */
export async function writeAssistantAudit(
  admin: Client,
  row: {
    leader_hub_user_id: string | null;
    slack_user_id: string;
    action: string;
    target_user_id?: string | null;
    pending_action_id?: string | null;
    payload?: Record<string, unknown> | null;
    result: AuditResult;
    detail?: string | null;
  }
) {
  try {
    await admin.from("slack_assistant_audit_log").insert({
      target_user_id: null,
      pending_action_id: null,
      payload: null,
      detail: null,
      ...row,
    });
  } catch (err) {
    console.error("[slack/hub-assistant] audit failed", err);
  }
}

/** The Hub-wide audit trail (audit_logs), user_id = the leader. */
export async function writeHubAudit(
  admin: Client,
  row: { user_id: string; action: string; resource_type: string; resource_id: string; changes: Record<string, unknown> }
) {
  try {
    await admin.from("audit_logs").insert(row);
  } catch (err) {
    console.error("[slack/hub-assistant] audit_logs failed", err);
  }
}
