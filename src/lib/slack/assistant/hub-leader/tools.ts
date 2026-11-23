/**
 * The five tools the "Hub" assistant's model may call. Nothing else: no
 * SQL, no general data access. Reads are scoped to the leader's team;
 * grant / revoke / resend only *propose* a change — the runner posts it
 * with Confirm and Cancel buttons and nothing is written until the leader
 * clicks Confirm (actions.ts), which checks everything again.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { HIDDEN_PERMISSION_KEYS } from "@/services/permissions";
import * as data from "./data";
import { checkPermissionChange, checkResendInvite, getTeam, matchPerson, NOT_IN_TEAM, type Leader, type Person } from "./rules";
import { reportProblem } from "./tickets";

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
  {
    name: "report_problem",
    description:
      "File a problem report for the Hub team, in the leader's words. Use when something in the Hub is broken or the leader asks for something you can't do.",
    input_schema: {
      type: "object",
      properties: { message: { type: "string", description: "What's wrong, with any detail the leader gave." } },
      required: ["message"],
    },
  },
];

export const HUB_LEADER_TOOL_NAMES = new Set(HUB_LEADER_TOOLS.map((t) => t.name));

/** A change waiting on the leader's Confirm click. */
export type Proposal = { pendingId: string; summary: string };

export type ToolOutcome = { output: unknown; proposal?: Proposal };

export type ToolContext = { admin: Client; leader: Leader; channelId: string };

function scopeLabel(labels: Map<string, string>, t: string | null, id: string | null) {
  if (!t || !id) return "everywhere";
  return `${t}: ${labels.get(`${t}:${id}`) ?? id}`;
}

async function accessFor(admin: Client, people: Person[]) {
  const rows = await Promise.all(
    people.map(async (p) => {
      const [direct, roleKeys, roles] = await Promise.all([
        data.getDirectGrants(admin, p.user_id),
        data.getRoleKeys(admin, p.user_id),
        data.getRoleNames(admin, p.user_id),
      ]);
      return { p, direct: direct.filter((g) => !HIDDEN_PERMISSION_KEYS.has(g.key)), roleKeys, roles };
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
  // Re-check on every call: someone can stop leading mid-conversation.
  const ministries = await data.getLedMinistries(admin, leader.hubUserId);
  if (ministries.length === 0) return { output: { error: "This assistant is only available to ministry leaders." } };
  const live: Leader = { ...leader, ministries };
  const c: ToolContext = { ...ctx, leader: live };

  switch (name) {
    case "list_team_access": {
      const team = await getTeam(admin, live);
      const access = await accessFor(admin, team);
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
      const [access] = await accessFor(admin, [found.person]);
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

    case "report_problem": {
      const message = typeof input.message === "string" ? input.message.trim() : "";
      if (!message) return { output: { error: "What's the problem? I need a short description." } };
      const res = await reportProblem(admin, live, message);
      return { output: res.ok ? { filed: true, message: "Filed for the Hub team." } : { error: "I couldn't file that just now." } };
    }

    default:
      return { output: { error: "That isn't something I can do." } };
  }
}

async function propose(
  ctx: ToolContext,
  actionType: data.PendingActionType,
  payload: Record<string, unknown>,
  targetUserId: string,
  summary: string
): Promise<ToolOutcome> {
  const pendingId = await data.insertPending(ctx.admin, {
    leader_hub_user_id: ctx.leader.hubUserId,
    slack_user_id: ctx.leader.slackUserId,
    slack_channel_id: ctx.channelId,
    action_type: actionType,
    payload,
  });
  if (!pendingId) return { output: { error: "I couldn't set that up just now. Try again in a minute." } };
  await data.writeAssistantAudit(ctx.admin, {
    leader_hub_user_id: ctx.leader.hubUserId,
    slack_user_id: ctx.leader.slackUserId,
    action: actionType,
    target_user_id: targetUserId,
    pending_action_id: pendingId,
    payload,
    result: "proposed",
  });
  return {
    output: {
      awaiting_confirmation: true,
      message: "Nothing has changed yet. A message with Confirm and Cancel buttons will be posted; the change happens only if the leader presses Confirm within 10 minutes.",
    },
    proposal: { pendingId, summary },
  };
}
