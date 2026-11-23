/**
 * Who a ministry leader may see and change through the "Hub" Slack
 * assistant. Every tool call runs these checks, and so does every Confirm
 * click — nothing the model says or a button carries is trusted.
 *
 *   - A leader is someone with an active `leader` membership in a staff
 *     ministry (staff_ministry_members). users.department is a label and
 *     point-leader subcategories don't count.
 *   - Their team is the active members of the ministries they lead.
 *     Anyone else is "not found" — the assistant never confirms that a
 *     person outside the team exists in the Hub.
 *   - They can grant or revoke a permission for a team member only if they
 *     hold it themselves, with the same scope, and it isn't one of the
 *     keys kept for admins (BLOCKED_PERMISSION_KEYS). Roles are never
 *     changed from Slack.
 *   - Not themselves, and not an admin (those changes go through the Hub).
 *   - An invite resend only for a team member with an email and no
 *     password yet.
 */

import { SUPER_ADMIN_ONLY_PERMISSION_KEYS } from "@/lib/auth/check-role-grant";
import { HIDDEN_PERMISSION_KEYS } from "@/services/permissions";
import * as data from "./data";
import type { Ministry, PermissionRow, TeamMember } from "./data";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/**
 * Keys a leader can never hand out or take away from Slack, even if they
 * hold them: role management, the Records Library, legal records, bulk
 * imports and exports, organisation-wide OKRs, money approval and the
 * unsubscribe list. Those go through a Hub admin.
 */
export const BLOCKED_PERMISSION_KEYS = new Set<string>([
  ...SUPER_ADMIN_ONLY_PERMISSION_KEYS,
  "administration.manage_roles",
  "legal.access",
  "imports.run",
  "contacts.export",
  "okrs.manage_all",
  "finance.approve",
  "unsubscribes.manage",
]);
const BLOCKED_MODULES = new Set(["administration", "records_library"]);

const SCOPE_TYPES = new Set(["program", "team", "event"]);
const ASSIGNABLE_CONTACT_KEY = "schools.assignable_as_contact";

export const NOT_IN_TEAM =
  "I can only look up people in the ministries you lead, and I couldn't match that name there.";

export type Leader = { hubUserId: string; slackUserId: string; ministries: Ministry[] };

export type Refusal = { ok: false; reason: string };

// ────────────────────────────────────────────────────────────
// The asker
// ────────────────────────────────────────────────────────────

export type LeaderResolution =
  | { kind: "unlinked" }
  | { kind: "not_leader"; hubUserId: string }
  | { kind: "leader"; leader: Leader };

export async function resolveLeader(
  admin: Client,
  slackUserId: string,
  resolveHubUser: (admin: Client, slackUserId: string) => Promise<string | null>
): Promise<LeaderResolution> {
  const hubUserId = await resolveHubUser(admin, slackUserId);
  if (!hubUserId) return { kind: "unlinked" };
  const ministries = await data.getLedMinistries(admin, hubUserId);
  if (ministries.length === 0) return { kind: "not_leader", hubUserId };
  return { kind: "leader", leader: { hubUserId, slackUserId, ministries } };
}

// ────────────────────────────────────────────────────────────
// The team
// ────────────────────────────────────────────────────────────

export type Person = {
  user_id: string;
  name: string;
  email: string | null;
  ministries: string[];
};

/** Team members merged across ministries (one entry per person). */
export async function getTeam(admin: Client, leader: Leader): Promise<Person[]> {
  const rows = await data.getTeamMembers(admin, leader.ministries.map((m) => m.id));
  return mergeMembers(rows);
}

export function mergeMembers(rows: TeamMember[]): Person[] {
  const byId = new Map<string, Person>();
  for (const r of rows) {
    const p = byId.get(r.user_id);
    if (p) {
      if (!p.ministries.includes(r.ministry_name)) p.ministries.push(r.ministry_name);
      continue;
    }
    const name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.email || "Unnamed";
    byId.set(r.user_id, { user_id: r.user_id, name, email: r.email, ministries: [r.ministry_name] });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type Match =
  | { kind: "ok"; person: Person }
  | { kind: "ambiguous"; candidates: Person[] }
  | { kind: "not_found" };

/**
 * Find someone in the team by name, email or user id. Only the team is
 * searched, so a miss says nothing about the rest of the Hub.
 */
export function matchPerson(team: Person[], query: { person?: unknown; user_id?: unknown }): Match {
  if (typeof query.user_id === "string" && query.user_id) {
    const p = team.find((t) => t.user_id === query.user_id);
    return p ? { kind: "ok", person: p } : { kind: "not_found" };
  }
  const term = typeof query.person === "string" ? query.person.trim().toLowerCase() : "";
  if (!term) return { kind: "not_found" };

  const exact = team.filter((t) => t.name.toLowerCase() === term || (t.email ?? "").toLowerCase() === term);
  if (exact.length === 1) return { kind: "ok", person: exact[0] };
  if (exact.length > 1) return { kind: "ambiguous", candidates: exact.slice(0, 6) };

  const words = term.split(/\s+/).filter(Boolean);
  const hits = team.filter((t) => {
    const hay = `${t.name} ${t.email ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  if (hits.length === 1) return { kind: "ok", person: hits[0] };
  if (hits.length > 1) return { kind: "ambiguous", candidates: hits.slice(0, 6) };
  return { kind: "not_found" };
}

// ────────────────────────────────────────────────────────────
// Permission changes
// ────────────────────────────────────────────────────────────

export type PermissionChange = {
  action: "grant" | "revoke";
  targetUserId: string;
  permissionKey: string;
  scopeType: string | null;
  scopeId: string | null;
};

export type CheckedChange = {
  ok: true;
  target: Person;
  permission: PermissionRow;
  scopeType: string | null;
  scopeId: string | null;
};

function normaliseScope(scopeType: unknown, scopeId: unknown): { scopeType: string | null; scopeId: string | null } | null {
  const t = typeof scopeType === "string" && scopeType.trim() ? scopeType.trim() : null;
  const i = typeof scopeId === "string" && scopeId.trim() ? scopeId.trim() : null;
  if (!t && !i) return { scopeType: null, scopeId: null };
  if (!t || !i || !SCOPE_TYPES.has(t)) return null;
  return { scopeType: t, scopeId: i };
}

export function isBlockedKey(key: string): boolean {
  return BLOCKED_PERMISSION_KEYS.has(key) || BLOCKED_MODULES.has(key.split(".")[0]);
}

/** Can this leader make this permission change right now? */
export async function checkPermissionChange(
  admin: Client,
  leader: Leader,
  change: PermissionChange
): Promise<CheckedChange | Refusal> {
  const key = (change.permissionKey ?? "").trim();
  if (!key) return { ok: false, reason: "Which permission? Give me its key, like `events.view`." };
  // Roles (job titles, admin tiers) are not permission keys and never change here.
  if (!key.includes(".")) {
    return { ok: false, reason: "I can't change roles. A Hub admin can do that on the Users page." };
  }

  const scope = normaliseScope(change.scopeType, change.scopeId);
  if (!scope) {
    return { ok: false, reason: "That scope isn't one I understand. A scope needs both a type (program, team or event) and an id." };
  }

  if (leader.ministries.length === 0) return { ok: false, reason: "This assistant is only available to ministry leaders." };

  const team = await getTeam(admin, leader);
  const target = team.find((p) => p.user_id === change.targetUserId);
  if (!target) return { ok: false, reason: NOT_IN_TEAM };
  if (target.user_id === leader.hubUserId) {
    return { ok: false, reason: "I can't change your own access. Ask another leader or a Hub admin." };
  }
  if (await data.isAdminTier(admin, target.user_id)) {
    return { ok: false, reason: `${target.name} is a Hub admin, so changes to their access go through a Hub admin.` };
  }

  if (isBlockedKey(key)) {
    return { ok: false, reason: `I can't hand out or take away \`${key}\` from Slack. Ask a Hub admin.` };
  }
  if (HIDDEN_PERMISSION_KEYS.has(key)) {
    return { ok: false, reason: `\`${key}\` is an old name for another permission. Use the current one instead.` };
  }

  const permission = await data.getPermissionByKey(admin, key);
  if (!permission) return { ok: false, reason: `I don't know a permission called \`${key}\`.` };

  if (key === ASSIGNABLE_CONTACT_KEY && scope.scopeType !== "program") {
    return { ok: false, reason: "That permission only works for a specific school (program scope)." };
  }

  // "Can only grant what you hold" — and with the same reach.
  const held = await data.getEffectiveKeys(admin, leader.hubUserId);
  if (!held.has(key)) {
    return { ok: false, reason: `You don't hold \`${key}\` yourself, so you can't ${change.action} it.` };
  }
  const [leaderDirect, leaderRoleKeys] = await Promise.all([
    data.getDirectGrants(admin, leader.hubUserId),
    data.getRoleKeys(admin, leader.hubUserId),
  ]);
  const leaderGlobal = leaderRoleKeys.has(key) || leaderDirect.some((g) => g.key === key && !g.scope_type && !g.scope_id);
  const leaderScopes = leaderDirect.filter((g) => g.key === key && g.scope_type && g.scope_id);
  if (scope.scopeType === null) {
    if (!leaderGlobal) {
      const hint = leaderScopes.length > 0 ? " You hold it for specific scopes — say which one." : "";
      return { ok: false, reason: `You only hold \`${key}\` for specific scopes, so you can't ${change.action} it everywhere.${hint}` };
    }
  } else if (!leaderScopes.some((g) => g.scope_type === scope.scopeType && g.scope_id === scope.scopeId)) {
    return { ok: false, reason: `You don't hold \`${key}\` for that ${scope.scopeType}, so you can't ${change.action} it there.` };
  }

  const targetDirect = await data.getDirectGrants(admin, target.user_id);
  const targetHasExact = targetDirect.some(
    (g) => g.key === key && (g.scope_type ?? null) === scope.scopeType && (g.scope_id ?? null) === scope.scopeId
  );
  if (change.action === "grant" && targetHasExact) {
    return { ok: false, reason: `${target.name} already has \`${key}\` there.` };
  }
  if (change.action === "revoke" && !targetHasExact) {
    const roleKeys = await data.getRoleKeys(admin, target.user_id);
    if (roleKeys.has(key) && scope.scopeType === null) {
      return { ok: false, reason: `${target.name} gets \`${key}\` from their role, not a direct grant. A Hub admin can change their role.` };
    }
    return { ok: false, reason: `${target.name} doesn't have \`${key}\` granted there, so there's nothing to remove.` };
  }

  return { ok: true, target, permission, scopeType: scope.scopeType, scopeId: scope.scopeId };
}

// ────────────────────────────────────────────────────────────
// Invite resends
// ────────────────────────────────────────────────────────────

export type CheckedResend = { ok: true; target: Person; email: string; firstName: string | null };

export async function checkResendInvite(
  admin: Client,
  leader: Leader,
  targetUserId: string
): Promise<CheckedResend | Refusal> {
  if (leader.ministries.length === 0) return { ok: false, reason: "This assistant is only available to ministry leaders." };
  const team = await getTeam(admin, leader);
  const target = team.find((p) => p.user_id === targetUserId);
  if (!target) return { ok: false, reason: NOT_IN_TEAM };
  if (target.user_id === leader.hubUserId) {
    return { ok: false, reason: "You're already signed in, so there's no invite to resend." };
  }
  const user = await data.getInviteTarget(admin, target.user_id);
  if (!user?.email) return { ok: false, reason: `${target.name} has no email on file, so I can't send an invite. A Hub admin can add one.` };
  if (await data.hasPassword(admin, target.user_id)) {
    return {
      ok: false,
      reason: `${target.name} has already finished setting up their account. If they're locked out, they can reset their password from the login page.`,
    };
  }
  return { ok: true, target, email: user.email, firstName: user.first_name };
}

// ────────────────────────────────────────────────────────────
// What the leader could hand out (for the system prompt)
// ────────────────────────────────────────────────────────────

export async function getGrantableSummary(admin: Client, leader: Leader): Promise<string[]> {
  const [held, direct, roleKeys] = await Promise.all([
    data.getEffectiveKeys(admin, leader.hubUserId),
    data.getDirectGrants(admin, leader.hubUserId),
    data.getRoleKeys(admin, leader.hubUserId),
  ]);
  const out: string[] = [];
  for (const key of [...held].sort()) {
    if (isBlockedKey(key) || HIDDEN_PERMISSION_KEYS.has(key)) continue;
    const global = roleKeys.has(key) || direct.some((g) => g.key === key && !g.scope_type);
    const scopes = direct.filter((g) => g.key === key && g.scope_type && g.scope_id).map((g) => `${g.scope_type}:${g.scope_id}`);
    const parts = [global ? "everywhere" : null, ...scopes].filter(Boolean);
    out.push(`${key} (${parts.join(", ") || "everywhere"})`);
  }
  return out;
}
