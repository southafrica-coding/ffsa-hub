import * as slackClient from "@/lib/slack/client";
import { previewWritesDisabled } from "@/lib/preview-writes";
import { hubFormsSlackEnabled } from "./flags";
import type { FiredRoute } from "./schema";
import type { RouteRunResult, RouteSubject } from "./route-runner";

// ============================================================
// Slack DMs from form routes (Hub Forms F3)
// ============================================================
// Same card style as the vehicle coordinator DMs
// (lib/vehicles/slack-alerts.ts): a direct message, never a channel,
// with what fired and an Open in Hub button. When a house sends the
// same week again the DM is rewritten in place
// (form_route_slack_messages, migration 391). If nothing fires this
// time, an earlier DM is rewritten to say so and nobody new is told.
//
// Off unless hubFormsSlackEnabled() (flags.ts): HUB_FORMS_SLACK_ENABLED
// on, the live site, and preview writes not disabled. Off means no
// Slack call and no database read here, and no throw.
//
// Targets (the route's `target`):
//   person:<users.id>  one Hub user
//   coach              the house's current coach
//   pastors            Missio pastors
//   department         the leaders of the form's department
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type SlackApi = Pick<typeof slackClient, "openConversation" | "postMessage" | "updateMessage">;

export type SlackReason = {
  fired: FiredRoute;
  /** The answer is a care need: say it went to Care, never quote it. */
  hidden: boolean;
  onCareBoard: boolean;
};

type House = { id: string; org_id: string; number: number; name: string | null };

export type RouteSlackInput = {
  form: { id: string; name: string; department_id?: string | null };
  submissionId: string;
  subject: RouteSubject | null;
  house: House | null;
  /** Meeting date for a house's week, else the submission id. */
  periodKey: string;
  reasons: SlackReason[];
};

type Block = Record<string, unknown>;
type Message = { text: string; blocks: Block[] };
type Recipient = { userId: string; slackUserId: string };

export const HF_OPEN = "hf_open";

const site = (env: NodeJS.ProcessEnv) => env.NEXT_PUBLIC_APP_URL ?? "https://www.ffsahub.com";
const section = (text: string): Block => ({ type: "section", text: { type: "mrkdwn", text } });
const context = (text: string): Block => ({ type: "context", elements: [{ type: "mrkdwn", text }] });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Slack mrkdwn: escape the three control characters. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function answerText(value: unknown): string {
  const s = Array.isArray(value) ? value.map(String).join(", ") : String(value);
  return s.length > 300 ? `${s.slice(0, 297)}…` : s;
}

// ── recipients ──────────────────────────────────────────────

async function slackUsers(db: Db, column: "id" | "contact_id", ids: string[]): Promise<Recipient[]> {
  if (ids.length === 0) return [];
  const { data } = await db.from("users").select("id, slack_user_id").in(column, ids);
  return ((data ?? []) as { id: string; slack_user_id: string | null }[])
    .filter((u) => u.slack_user_id)
    .map((u) => ({ userId: u.id, slackUserId: u.slack_user_id as string }));
}

async function recipientsFor(db: Db, target: string, input: RouteSlackInput): Promise<Recipient[]> {
  if (target.startsWith("person:")) {
    const id = target.slice("person:".length).trim();
    return UUID.test(id) ? slackUsers(db, "id", [id]) : [];
  }
  if (target === "coach") {
    if (!input.house) return [];
    const { data } = await db
      .from("missio_coach_assignments")
      .select("coach_contact_id")
      .eq("house_church_id", input.house.id)
      .is("ended_at", null);
    const contacts = ((data ?? []) as { coach_contact_id: string }[]).map((r) => r.coach_contact_id);
    return slackUsers(db, "contact_id", contacts);
  }
  if (target === "pastors") {
    let orgId = input.house?.org_id ?? null;
    if (!orgId) {
      const { data } = await db.from("organisations").select("id").eq("slug", "missio").maybeSingle();
      orgId = (data as { id: string } | null)?.id ?? null;
    }
    if (!orgId) return [];
    const { data } = await db.from("org_staff_roles").select("user_id").eq("org_id", orgId).eq("role", "pastor");
    return slackUsers(db, "id", ((data ?? []) as { user_id: string }[]).map((r) => r.user_id));
  }
  if (target === "department") {
    if (!input.form.department_id) return [];
    const { data } = await db
      .from("staff_ministry_members")
      .select("user_id")
      .eq("staff_ministry_id", input.form.department_id)
      .eq("member_role", "leader")
      .eq("status", "active");
    return slackUsers(db, "id", ((data ?? []) as { user_id: string }[]).map((r) => r.user_id));
  }
  return [];
}

// ── the card ────────────────────────────────────────────────

function openUrl(input: RouteSlackInput, env: NodeJS.ProcessEnv): string {
  return input.house
    ? `${site(env)}/missio/house-churches/${input.house.id}`
    : `${site(env)}/forms/${input.form.id}/responses`;
}

function heading(input: RouteSlackInput): string {
  const who = input.house ? (input.house.name ? `House ${input.house.number} · ${input.house.name}` : `House ${input.house.number}`) : null;
  return [esc(input.form.name), who ? esc(who) : null].filter(Boolean).join(" — ");
}

export function routeCard(input: RouteSlackInput, reasons: SlackReason[], env: NodeJS.ProcessEnv, sentAgain: boolean): Message {
  const lines = reasons.map(({ fired, hidden, onCareBoard }) => {
    const label = esc(fired.field.label);
    if (hidden) return `• *${label}:* ${onCareBoard ? "on the Care board for the pastors" : "answered (see the Hub)"}`;
    return `• *${label}:* ${esc(answerText(fired.value))}`;
  });
  const week = input.house && /^\d{4}-\d{2}-\d{2}$/.test(input.periodKey) ? ` · week of ${input.periodKey}` : "";
  return {
    text: `${input.form.name} — needs a look`,
    blocks: [
      section(`*📝 ${heading(input)}*${week}\n${lines.join("\n")}`),
      {
        type: "actions",
        block_id: `hf:${input.submissionId}`,
        elements: [
          { type: "button", action_id: HF_OPEN, text: { type: "plain_text", text: "Open in Hub" }, url: openUrl(input, env) },
        ],
      },
      context(sentAgain ? "They sent the form again, so this message was updated." : "If they send the form again this week, this message updates."),
    ],
  };
}

function quietCard(input: RouteSlackInput, env: NodeJS.ProcessEnv): Message {
  return {
    text: `${input.form.name} — nothing to look at now`,
    blocks: [
      section(`*📝 ${heading(input)}*\nThey sent the form again and nothing needs a look now.`),
      context(`<${openUrl(input, env)}|Open in Hub>`),
    ],
  };
}

// ── posting ─────────────────────────────────────────────────

type Tracked = { id: string; recipient_user_id: string; slack_channel: string; slack_ts: string };

function subjectKey(input: RouteSlackInput) {
  return { type: input.subject?.type ?? "none", id: input.subject?.id ?? null };
}

async function trackedRows(db: Db, input: RouteSlackInput): Promise<Tracked[] | null> {
  const key = subjectKey(input);
  let q = db
    .from("form_route_slack_messages")
    .select("id, recipient_user_id, slack_channel, slack_ts")
    .eq("form_id", input.form.id)
    .eq("subject_type", key.type)
    .eq("period_key", input.periodKey);
  q = key.id ? q.eq("subject_id", key.id) : q.is("subject_id", null);
  const { data, error } = await q;
  if (error) {
    console.error("[forms/slack] tracking read failed", error.message);
    return null;
  }
  return (data ?? []) as Tracked[];
}

async function dm(api: SlackApi, slackUserId: string, message: Message): Promise<{ channel: string; ts: string } | null> {
  const open = await api.openConversation(slackUserId);
  if (!open.ok || !open.channel?.id) {
    console.error("[forms/slack] conversations.open failed", open.error);
    return null;
  }
  const res = await api.postMessage({ channel: open.channel.id, ...message });
  if (!res.ok || !res.ts) {
    console.error("[forms/slack] postMessage failed", res.error);
    return null;
  }
  return { channel: res.channel ?? open.channel.id, ts: res.ts };
}

/** Send (or rewrite) the DMs for one submission. Never throws. */
export async function sendRouteSlack(
  db: Db,
  input: RouteSlackInput,
  deps: { env?: NodeJS.ProcessEnv; now?: Date; slack?: SlackApi } = {}
): Promise<RouteRunResult[]> {
  const env = deps.env ?? process.env;
  const api = deps.slack ?? slackClient;
  const each = (status: RouteRunResult["status"], reason: string) =>
    input.reasons.map(
      ({ fired }): RouteRunResult => ({
        fieldId: fired.field.id,
        action: "slack",
        target: fired.route.target?.trim() || null,
        status,
        reason,
      })
    );

  // Belt and braces: the flag already refuses previews.
  if (previewWritesDisabled(env)) return each("skipped", "preview");
  if (!hubFormsSlackEnabled(env)) return each("skipped", "flag_off");
  if (!env.SLACK_BOT_TOKEN) return each("skipped", "no_slack_token");

  try {
    // Who hears about what: one card per person, with every reason for them.
    const perPerson = new Map<string, { recipient: Recipient; reasons: SlackReason[] }>();
    const reached = new Set<SlackReason>();
    for (const reason of input.reasons) {
      const target = reason.fired.route.target?.trim() ?? "";
      for (const r of await recipientsFor(db, target, input)) {
        const entry = perPerson.get(r.userId) ?? { recipient: r, reasons: [] };
        if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
        perPerson.set(r.userId, entry);
        reached.add(reason);
      }
    }

    const tracked = await trackedRows(db, input);
    if (tracked === null) return each("failed", "tracking_unavailable");
    const byUser = new Map(tracked.map((t) => [t.recipient_user_id, t]));

    // Sent again and someone is no longer needed: rewrite their old DM.
    for (const t of tracked) {
      if (perPerson.has(t.recipient_user_id) || !t.slack_channel || !t.slack_ts) continue;
      await api.updateMessage({ channel: t.slack_channel, ts: t.slack_ts, ...quietCard(input, env) }).catch(() => null);
    }

    const sentTo = new Set<SlackReason>();
    const key = subjectKey(input);
    for (const { recipient, reasons } of perPerson.values()) {
      const old = byUser.get(recipient.userId);
      if (old?.slack_channel && old.slack_ts) {
        const res = await api
          .updateMessage({ channel: old.slack_channel, ts: old.slack_ts, ...routeCard(input, reasons, env, true) })
          .catch(() => null);
        if (res?.ok) {
          await db.from("form_route_slack_messages").update({ form_submission_id: input.submissionId }).eq("id", old.id);
          reasons.forEach((r) => sentTo.add(r));
        }
        continue;
      }
      // Someone else's send holds the claim and is posting right now.
      if (old) continue;
      // Claim first, so two sends racing cannot DM twice (vehicles do the same).
      const { data: claimed, error } = await db
        .from("form_route_slack_messages")
        .insert({
          form_id: input.form.id,
          subject_type: key.type,
          subject_id: key.id,
          period_key: input.periodKey,
          recipient_user_id: recipient.userId,
          form_submission_id: input.submissionId,
        })
        .select("id")
        .single();
      if (error || !claimed) continue;
      const rowId = (claimed as { id: string }).id;
      const posted = await dm(api, recipient.slackUserId, routeCard(input, reasons, env, false));
      if (posted) {
        await db.from("form_route_slack_messages").update({ slack_channel: posted.channel, slack_ts: posted.ts }).eq("id", rowId);
        reasons.forEach((r) => sentTo.add(r));
      } else {
        await db.from("form_route_slack_messages").delete().eq("id", rowId);
      }
    }

    return input.reasons.map(
      (reason): RouteRunResult => ({
        fieldId: reason.fired.field.id,
        action: "slack",
        target: reason.fired.route.target?.trim() || null,
        status: sentTo.has(reason) ? "done" : reached.has(reason) ? "failed" : "skipped",
        ...(sentTo.has(reason) ? {} : { reason: reached.has(reason) ? "slack_error" : "no_recipient" }),
      })
    );
  } catch (err) {
    console.error("[forms/slack] send failed", err);
    return each("failed", "slack_error");
  }
}
