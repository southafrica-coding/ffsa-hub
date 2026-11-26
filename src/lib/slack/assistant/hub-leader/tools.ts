/**
 * The tools the "Hub" assistant's model may call — this allowlist and
 * nothing else: no SQL, no general data access, no URL fetching.
 *
 * Team tools (here): reads scoped to the leader's team; grant / revoke /
 * resend only *propose* a change — the runner posts it with Confirm and
 * Cancel buttons and nothing is written until the leader clicks Confirm
 * (actions.ts), which checks everything again. Ministry leaders only.
 *
 * Everything else (tools-hub.ts): bookings, approvals, contacts, forms,
 * hire stock, Hub help and problem reports, each gated by the asker's own
 * Hub permissions on every call.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { HIDDEN_PERMISSION_KEYS } from "@/services/permissions";
import * as data from "./data";
import { checkPermissionChange, checkResendInvite, getTeam, loadLeadership, matchPerson, NO_TEAM, NOT_IN_TEAM, NOT_LEADER, type Leader, type Person } from "./rules";
import { HUB_TOOLS, executeHubTool, HUB_TOOL_NAMES } from "./tools-hub";
import { propose, type Proposal, type ToolContext, type ToolOutcome } from "./propose";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const personProps = {
  person: { type: "string", description: "The person's name or email, as the leader wrote it." },
  user_id: { type: "string", description: "A user_id from an earlier candidates list, when the leader picked one." },
} as const;

const scopeProps = {
  scope_type: {
    type: "string",
    enum: ["program", "team", "event"],
    description: "Only for a scoped grant: the kind of scope. Leave out for an everywhere grant.",
  },
  scope_id: { type: "string", description: "Only for a scoped grant: the scope id from the leader's own grants." },
} as const;

export const HUB_LEADER_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_team_access",
    description:
      "List the people in the ministries this leader leads, grouped by ministry, with each person's roles and Hub permissions.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "lookup_person_access",
    description:
      "Look up one person's Hub access (roles, direct permissions and those from roles). Only finds people in the leader's ministries. If several match, returns candidates — ask which one.",
    input_schema: { type: "object", properties: { ...personProps } },
  },
  {
    name: "grant_permission",
    description:
      "Propose giving a team member a Hub permission. Does NOT make the change: the leader gets Confirm / Cancel buttons. Only permission keys (like events.view), never roles.",
    input_schema: {
      type: "object",
      properties: { ...personProps, permission_key: { type: "string" }, ...scopeProps },
      required: ["permission_key"],
    },
  },
  {
    name: "revoke_permission",
    description:
      "Propose removing a Hub permission a team member was granted directly. Does NOT make the change: the leader gets Confirm / Cancel buttons.",
    input_schema: {
      type: "object",
      properties: { ...personProps, permission_key: { type: "string" }, ...scopeProps },
      required: ["permission_key"],
    },
  },
  {
    name: "resend_invite",
    description:
      "Propose resending the Hub setup invite to a team member who hasn't finished setting up their account. Does NOT send: the leader gets Confirm / Cancel buttons.",
    input_schema: { type: "object", properties: { ...personProps } },
  },
  ...HUB_TOOLS,
];

export const HUB_LEADER_TOOL_NAMES = new Set(HUB_LEADER_TOOLS.map((t) => t.name));

/** The tools that need a team (the ministries the asker leads). */
export const TEAM_TOOL_NAMES = new Set([
  "list_team_access",
  "lookup_person_access",
  "grant_permission",
  "revoke_permission",
  "resend_invite",
]);

export type { Proposal, ToolContext, ToolOutcome };

function scopeLabel(labels: Map<string, string>, t: string | null, id: string | null) {
  if (!t || !id) return "everywhere";
  return `${t}: ${labels.get(`${t}:${id}`) ?? id}`;
}

/**
 * Team members' access, as far as the leader may see it. Grants with no
 * scope ("everywhere") are shown. A scoped grant (program, team or event —
 * the only scope types user_permissions has) is shown only where the
 * leader holds a grant at that same scope themselves, which also covers
 * every scope checkPermissionChange would let them grant or revoke at.
 * Anything scoped elsewhere is left out entirely: no row, no id, no label.
 */
async function accessFor(admin: Client, leader: Leader, people: Person[]) {
  const own = await data.getDirectGrants(admin, leader.hubUserId);
  const visibleScopes = new Set(own.filter((g) => g.scope_type && g.scope_id).map((g) => `${g.scope_type}:${g.scope_id}`));
  const mayShow = (g: data.DirectGrant) => (!g.scope_type && !g.scope_id) || visibleScopes.has(`${g.scope_type}:${g.scope_id}`);
  const rows = await Promise.all(
    people.map(async (p) => {
      const [direct, roleKeys, roles] = await Promise.all([
        data.getDirectGrants(admin, p.user_id),
        data.getRoleKeys(admin, p.user_id),
        data.getRoleNames(admin, p.user_id),
      ]);
      return { p, direct: direct.filter((g) => !HIDDEN_PERMISSION_KEYS.has(g.key) && mayShow(g)), roleKeys, roles };
    })
  );
  const scopes = rows.flatMap((r) =>
    r.direct.filter((g) => g.scope_type && g.scope_id).map((g) => ({ scope_type: g.scope_type!, scope_id: g.scope_id! }))
  );
  const labels = scopes.length > 0 ? await data.getScopeLabels(admin, scopes) : new Map<string, string>();
  return rows.map(({ p, direct, roleKeys, roles }) => ({
    user_id: p.user_id,
    name: p.name,
    email: p.email,
    ministries: p.ministries,
    roles,
    permissions: direct.map((g) => ({
      key: g.key,
      name: g.display_name,
      scope: scopeLabel(labels, g.scope_type, g.scope_id),
      scope_type: g.scope_type,
      scope_id: g.scope_id,
    })),
    from_roles: [...roleKeys].filter((k) => !HIDDEN_PERMISSION_KEYS.has(k)).sort(),
  }));
}

/** Resolve the tool's person argument inside the team. */
async function findTarget(ctx: ToolContext, input: Record<string, unknown>) {
  const team = await getTeam(ctx.admin, ctx.leader);
  const match = matchPerson(team, { person: input.person, user_id: input.user_id });
  if (match.kind === "ok") return { person: match.person };
  if (match.kind === "ambiguous") {
    return {
      output: {
        needs_clarification: true,
        message: "Several people in your ministries match. Ask which one.",
        candidates: match.candidates.map((c) => ({ user_id: c.user_id, name: c.name, email: c.email, ministries: c.ministries })),
      },
    };
  }
  return { output: { error: NOT_IN_TEAM } };
}

export async function executeHubLeaderTool(
  ctx: ToolContext,
  name: string,
  input: Record<string, unknown>
): Promise<ToolOutcome> {
  const { admin, leader } = ctx;
  if (!HUB_LEADER_TOOL_NAMES.has(name)) return { output: { error: "That isn't something I can do." } };
  // Re-check on every call: someone can stop leading mid-conversation.
  const standing = await loadLeadership(admin, leader.hubUserId);
  if (!standing) return { output: { error: NOT_LEADER } };
  const live: Leader = { ...leader, ...standing };
  const c: ToolContext = { ...ctx, leader: live };
  const ministries = live.ministries;

  if (!TEAM_TOOL_NAMES.has(name)) return HUB_TOOL_NAMES.has(name) ? executeHubTool(c, name, input) : { output: { error: "That isn't something I can do." } };
  if (ministries.length === 0) return { output: { refused: true, reason: NO_TEAM } };

  switch (name) {
    case "list_team_access": {
      const team = await getTeam(admin, live);
      const access = await accessFor(admin, live, team);
      return {
        output: {
          ministries: ministries.map((m) => ({
            ministry: m.name,
            people: access.filter((a) => a.ministries.includes(m.name)).map(({ ministries: _m, ...rest }) => rest), // eslint-disable-line @typescript-eslint/no-unused-vars
          })),
        },
      };
    }

    case "lookup_person_access": {
      const found = await findTarget(c, input);
      if (!found.person) return { output: found.output };
      const [access] = await accessFor(admin, live, [found.person]);
      return { output: access };
    }

    case "grant_permission":
    case "revoke_permission": {
      const found = await findTarget(c, input);
      if (!found.person) return { output: found.output };
      const action = name === "grant_permission" ? "grant" : "revoke";
      const checked = await checkPermissionChange(admin, live, {
        action,
        targetUserId: found.person.user_id,
        permissionKey: typeof input.permission_key === "string" ? input.permission_key : "",
        scopeType: typeof input.scope_type === "string" ? input.scope_type : null,
        scopeId: typeof input.scope_id === "string" ? input.scope_id : null,
      });
      if (!checked.ok) return { output: { refused: true, reason: checked.reason } };
      const where = checked.scopeType ? ` (${checked.scopeType} ${checked.scopeId})` : "";
      const summary =
        action === "grant"
          ? `Give *${checked.target.name}* the *${checked.permission.display_name}* permission (\`${checked.permission.key}\`)${where}?`
          : `Remove the *${checked.permission.display_name}* permission (\`${checked.permission.key}\`)${where} from *${checked.target.name}*?`;
      return propose(c, name, { target_user_id: checked.target.user_id, permission_key: checked.permission.key, scope_type: checked.scopeType, scope_id: checked.scopeId }, checked.target.user_id, summary);
    }

    case "resend_invite": {
      const found = await findTarget(c, input);
      if (!found.person) return { output: found.output };
      const checked = await checkResendInvite(admin, live, found.person.user_id);
      if (!checked.ok) return { output: { refused: true, reason: checked.reason } };
      return propose(c, name, { target_user_id: checked.target.user_id }, checked.target.user_id, `Resend the Hub setup invite to *${checked.target.name}* (${checked.email})?`);
    }

    default:
      return { output: { error: "That isn't something I can do." } };
  }
}
