/**
 * An in-memory stand-in for ./data, for the hub-leader tests only. Same
 * function names and shapes; every value is made up. Tests mock ./data
 * with makeFakeData(state) and inspect state afterwards.
 */

import type { DirectGrant, PendingActionType, PendingRow, PermissionRow } from "./data";

export type FakeState = {
  ministries: { id: string; name: string }[];
  memberships: { user_id: string; ministry_id: string; member_role: "member" | "leader"; status: "active" | "pending" }[];
  users: {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    is_active?: boolean;
    has_password?: boolean;
    admin?: boolean;
  }[];
  permissions: PermissionRow[];
  direct: { user_id: string; key: string; scope_type: string | null; scope_id: string | null }[];
  roleKeys: Record<string, string[]>;
  roleNames: Record<string, string[]>;
  pending: (PendingRow & { slack_channel_id?: string; result?: string | null })[];
  grants: unknown[];
  revokes: unknown[];
  tickets: Record<string, unknown>[];
  audit: Record<string, unknown>[];
  hubAudit: Record<string, unknown>[];
};

export const MINISTRY_WORSHIP = "m-worship";
export const MINISTRY_MEDIA = "m-media";
export const MINISTRY_OTHER = "m-other";

/** A leader of Worship (and nothing else), two team members, and an outsider. */
export function baseState(): FakeState {
  return {
    ministries: [
      { id: MINISTRY_WORSHIP, name: "Worship" },
      { id: MINISTRY_MEDIA, name: "Media" },
      { id: MINISTRY_OTHER, name: "Hospitality" },
    ],
    memberships: [
      { user_id: "u-lead", ministry_id: MINISTRY_WORSHIP, member_role: "leader", status: "active" },
      { user_id: "u-amy", ministry_id: MINISTRY_WORSHIP, member_role: "member", status: "active" },
      { user_id: "u-ben", ministry_id: MINISTRY_WORSHIP, member_role: "member", status: "active" },
      { user_id: "u-pend", ministry_id: MINISTRY_WORSHIP, member_role: "member", status: "pending" },
      { user_id: "u-out", ministry_id: MINISTRY_OTHER, member_role: "member", status: "active" },
      { user_id: "u-plain", ministry_id: MINISTRY_OTHER, member_role: "member", status: "active" },
    ],
    users: [
      { id: "u-lead", first_name: "Lee", last_name: "Leader", email: "lee@example.test", has_password: true },
      { id: "u-amy", first_name: "Amy", last_name: "Adams", email: "amy@example.test", has_password: false },
      { id: "u-ben", first_name: "Ben", last_name: "Brown", email: "ben@example.test", has_password: true },
      { id: "u-pend", first_name: "Pat", last_name: "Pending", email: "pat@example.test", has_password: false },
      { id: "u-out", first_name: "Olive", last_name: "Outsider", email: "olive@example.test", has_password: false },
      { id: "u-plain", first_name: "Paul", last_name: "Plain", email: "paul@example.test", has_password: true },
    ],
    permissions: [
      { id: "p-events-view", key: "events.view", display_name: "View events", module: "events" },
      { id: "p-bookings-request", key: "bookings.request", display_name: "Request bookings", module: "bookings" },
      { id: "p-schools-view", key: "schools.view", display_name: "View schools", module: "schools" },
      { id: "p-finance-view", key: "finance.view", display_name: "View finance", module: "finance" },
      { id: "p-manage-roles", key: "administration.manage_roles", display_name: "Manage roles", module: "administration" },
      { id: "p-records", key: "records_library.manage", display_name: "Records Library", module: "records_library" },
      { id: "p-contact", key: "schools.assignable_as_contact", display_name: "Assignable as contact", module: "schools" },
    ],
    direct: [
      { user_id: "u-lead", key: "events.view", scope_type: null, scope_id: null },
      { user_id: "u-lead", key: "schools.view", scope_type: "program", scope_id: "prog-1" },
      { user_id: "u-lead", key: "administration.manage_roles", scope_type: null, scope_id: null },
      { user_id: "u-lead", key: "records_library.manage", scope_type: null, scope_id: null },
      { user_id: "u-ben", key: "events.view", scope_type: null, scope_id: null },
    ],
    roleKeys: { "u-lead": ["bookings.request"], "u-ben": ["bookings.request"] },
    roleNames: { "u-lead": ["staff"], "u-ben": ["staff"] },
    pending: [],
    grants: [],
    revokes: [],
    tickets: [],
    audit: [],
    hubAudit: [],
  };
}

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export function makeFakeData(s: FakeState) {
  const keyOf = (k: string) => s.permissions.find((p) => p.key === k);
  const grantsOf = (userId: string): DirectGrant[] =>
    s.direct
      .filter((d) => d.user_id === userId)
      .map((d) => ({
        permission_id: keyOf(d.key)?.id ?? d.key,
        key: d.key,
        display_name: keyOf(d.key)?.display_name ?? d.key,
        scope_type: d.scope_type,
        scope_id: d.scope_id,
      }));

  return {
    PENDING_TTL_MS: 10 * 60 * 1000,
    getLedMinistries: async (_a: unknown, userId: string) =>
      s.memberships
        .filter((m) => m.user_id === userId && m.member_role === "leader" && m.status === "active")
        .map((m) => s.ministries.find((x) => x.id === m.ministry_id)!),
    getTeamMembers: async (_a: unknown, ids: string[]) =>
      s.memberships
        .filter((m) => ids.includes(m.ministry_id) && m.status === "active")
        .flatMap((m) => {
          const u = s.users.find((x) => x.id === m.user_id);
          if (!u || u.is_active === false) return [];
          return [
            {
              user_id: m.user_id,
              ministry_id: m.ministry_id,
              ministry_name: s.ministries.find((x) => x.id === m.ministry_id)!.name,
              member_role: m.member_role,
              first_name: u.first_name,
              last_name: u.last_name,
              email: u.email,
            },
          ];
        }),
    getPermissionByKey: async (_a: unknown, key: string) => keyOf(key) ?? null,
    getDirectGrants: async (_a: unknown, userId: string) => grantsOf(userId),
    getRoleKeys: async (_a: unknown, userId: string) => new Set(s.roleKeys[userId] ?? []),
    getEffectiveKeys: async (_a: unknown, userId: string) =>
      new Set([...grantsOf(userId).map((g) => g.key), ...(s.roleKeys[userId] ?? [])]),
    getRoleNames: async (_a: unknown, userId: string) => s.roleNames[userId] ?? [],
    isAdminTier: async (_a: unknown, userId: string) => Boolean(s.users.find((u) => u.id === userId)?.admin),
    getScopeLabels: async () => new Map([["program:prog-1", "DTS Spring"]]),
    applyGrant: async (_a: unknown, args: { userId: string; permissionId: string; scopeType: string | null; scopeId: string | null }) => {
      s.grants.push(args);
      const key = s.permissions.find((p) => p.id === args.permissionId)!.key;
      s.direct.push({ user_id: args.userId, key, scope_type: args.scopeType, scope_id: args.scopeId });
      return { error: null };
    },
    applyRevoke: async (_a: unknown, args: unknown) => {
      s.revokes.push(args);
      return { error: null };
    },
    getInviteTarget: async (_a: unknown, userId: string) => {
      const u = s.users.find((x) => x.id === userId);
      return u ? { id: u.id, email: u.email, first_name: u.first_name } : null;
    },
    hasPassword: async (_a: unknown, userId: string) => Boolean(s.users.find((x) => x.id === userId)?.has_password),
    insertPending: async (
      _a: unknown,
      row: { leader_hub_user_id: string; slack_user_id: string; slack_channel_id: string; action_type: PendingActionType; payload: Record<string, unknown> }
    ) => {
      const id = uuid();
      s.pending.push({
        id,
        ...row,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        consumed_at: null,
        cancelled_at: null,
        result: null,
      });
      return id;
    },
    getPending: async (_a: unknown, id: string) => s.pending.find((p) => p.id === id) ?? null,
    claimPending: async (_a: unknown, id: string, how: "consumed" | "cancelled", result: string) => {
      const p = s.pending.find((x) => x.id === id);
      if (!p || p.consumed_at || p.cancelled_at || new Date(p.expires_at).getTime() <= Date.now()) return false;
      if (how === "consumed") p.consumed_at = new Date().toISOString();
      else p.cancelled_at = new Date().toISOString();
      p.result = result;
      return true;
    },
    setPendingResult: async (_a: unknown, id: string, result: string) => {
      const p = s.pending.find((x) => x.id === id);
      if (p) p.result = result;
    },
    insertTicket: async (_a: unknown, row: Record<string, unknown>) => {
      const id = uuid();
      s.tickets.push({ id, ...row });
      return id;
    },
    writeAssistantAudit: async (_a: unknown, row: Record<string, unknown>) => {
      s.audit.push(row);
    },
    writeHubAudit: async (_a: unknown, row: Record<string, unknown>) => {
      s.hubAudit.push(row);
    },
  };
}
