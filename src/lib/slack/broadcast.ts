/**
 * Broadcast DM engine — Hub → every person's Slack DM.
 *
 * This is the "everyone needs to know" path. Recipients are derived,
 * never subscribed: every active user with a linked slack_user_id,
 * minus anyone who muted the module, minus the actor. Nothing to keep
 * in sync, nothing to go stale.
 *
 * Each recipient gets a `notifications` row (migration 069) written
 * BEFORE the DM is attempted, then updated with the outcome. That
 * ordering matters: if Slack is down, or someone has no Slack account,
 * the record of what they should have been told still exists and
 * carries the error, rather than vanishing into a swallowed catch.
 *
 * Delivery is sequential with a small gap. Slack rate-limits
 * conversations.open harder than chat.postMessage (Tier 4 / ~50 per
 * minute), and at roughly 60 users a burst would trip it. Sequential
 * costs a few seconds, which is why every call site treats this as
 * fire-and-forget and never awaits it inside a user-facing request.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import * as slack from "./client";
import { findBroadcastType } from "./broadcast-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

/** Gap between DMs, in ms. Keeps us well under conversations.open limits. */
const SEND_INTERVAL_MS = 120;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type BroadcastResult = {
  ok: boolean;
  /** Why the whole broadcast was skipped, if it was. */
  skipped?: string;
  /** Users who were eligible (linked + unmuted). */
  targeted: number;
  delivered: number;
  failed: number;
  /** Active users with no Slack account linked — they got nothing. */
  unlinked: number;
};

type Recipient = { id: string; slack_user_id: string };

/**
 * Send a broadcast DM to everyone.
 *
 * Never throws: a Slack outage must not roll back the action that
 * triggered the notification. Callers log the returned result if they
 * want to surface delivery info in the UI.
 */
export async function sendBroadcast(args: {
  /** Key from BROADCAST_TYPES. */
  type: string;
  /** Slack fallback text + notifications.title. */
  title: string;
  /** Block Kit payload. */
  blocks: unknown[];
  /** Plain-text body stored on the notification row. */
  body?: string;
  /** Deep link into the Hub. */
  url?: string;
  /** Hub user id of whoever triggered this — excluded from delivery. */
  actorUserId?: string | null;
}): Promise<BroadcastResult> {
  const empty = { targeted: 0, delivered: 0, failed: 0, unlinked: 0 };

  const broadcastType = findBroadcastType(args.type);
  if (!broadcastType) {
    console.error("[slack/broadcast] unknown broadcast type", args.type);
    return { ok: false, skipped: "unknown_type", ...empty };
  }

  if (!process.env.SLACK_BOT_TOKEN) {
    console.warn("[slack/broadcast] SLACK_BOT_TOKEN missing — skipping");
    return { ok: false, skipped: "not_configured", ...empty };
  }

  const admin = createAdminClient();

  let recipients: Recipient[];
  let unlinked: number;
  try {
    const resolved = await resolveRecipients(admin, {
      module: broadcastType.module,
      actorUserId: args.actorUserId ?? null,
    });
    recipients = resolved.recipients;
    unlinked = resolved.unlinked;
  } catch (err) {
    console.error("[slack/broadcast] recipient resolution failed", err);
    return { ok: false, skipped: "resolve_failed", ...empty };
  }

  if (recipients.length === 0) {
    return { ok: true, skipped: "no_recipients", ...empty, unlinked };
  }

  let delivered = 0;
  let failed = 0;

  for (const [index, recipient] of recipients.entries()) {
    // Space out every call except the first.
    if (index > 0) await sleep(SEND_INTERVAL_MS);

    const notificationId = await recordNotification(admin, {
      recipientId: recipient.id,
      eventType: broadcastType.key,
      title: args.title,
      body: args.body ?? null,
      url: args.url ?? null,
    });

    const outcome = await deliverDm(recipient.slack_user_id, {
      text: args.title,
      blocks: args.blocks,
    });

    if (outcome.ok) delivered += 1;
    else failed += 1;

    if (notificationId) {
      await stampOutcome(admin, notificationId, outcome);
    }
  }

  return {
    ok: failed === 0,
    targeted: recipients.length,
    delivered,
    failed,
    unlinked,
  };
}

// ────────────────────────────────────────────────────────────
// Recipient resolution
// ────────────────────────────────────────────────────────────

/**
 * Everyone active with a Slack account, minus this module's muters and
 * minus the actor.
 *
 * `unlinked` counts active users with no slack_user_id. It is reported
 * rather than silently dropped so the admin coverage page can show how
 * much of the team a broadcast actually reaches.
 */
async function resolveRecipients(
  admin: AdminClient,
  opts: { module: string; actorUserId: string | null }
): Promise<{ recipients: Recipient[]; unlinked: number }> {
  const { data, error } = await admin
    .from("users")
    .select("id, slack_user_id")
    .neq("is_active", false);
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    id: string;
    slack_user_id: string | null;
  }>;

  const linked = rows.filter((u) => !!u.slack_user_id);
  const unlinked = rows.length - linked.length;

  const muted = await listMutedUserIds(admin, opts.module);

  const recipients = linked
    .filter((u) => u.id !== opts.actorUserId)
    .filter((u) => !muted.has(u.id))
    .map((u) => ({ id: u.id, slack_user_id: u.slack_user_id as string }));

  return { recipients, unlinked };
}

/** User ids that have muted this module. Absent prefs row = not muted. */
async function listMutedUserIds(
  admin: AdminClient,
  moduleKey: string
): Promise<Set<string>> {
  const { data, error } = await admin
    .from("notification_preferences")
    .select("user_id, muted_modules")
    .contains("muted_modules", [moduleKey]);
  if (error) {
    // Fail OPEN on a prefs read error: better to over-deliver a
    // genuine all-hands message than to silently drop it for
    // everyone because one query failed.
    console.error("[slack/broadcast] muted lookup failed", error);
    return new Set();
  }
  return new Set(
    ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)
  );
}

// ────────────────────────────────────────────────────────────
// Delivery
// ────────────────────────────────────────────────────────────

type DeliveryOutcome = { ok: boolean; ts?: string; error?: string };

/** Open a DM channel with the user, then post into it. */
async function deliverDm(
  slackUserId: string,
  message: { text: string; blocks: unknown[] }
): Promise<DeliveryOutcome> {
  try {
    const convo = await slack.openConversation(slackUserId);
    const channelId = convo.channel?.id;
    if (!convo.ok || !channelId) {
      return { ok: false, error: convo.error ?? "conversations_open_failed" };
    }

    const res = await slack.postMessage({
      channel: channelId,
      text: message.text,
      blocks: message.blocks,
    });
    if (!res.ok) return { ok: false, error: res.error ?? "post_failed" };

    return { ok: true, ts: res.ts };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ────────────────────────────────────────────────────────────
// notifications bookkeeping
// ────────────────────────────────────────────────────────────

/**
 * Write the row before attempting delivery. Returns null (and logs) on
 * failure — a bookkeeping problem shouldn't stop the DM going out.
 *
 * tier is 'tier1' because a broadcast is by definition something the
 * recipient is meant to see now; the 069 tier model is otherwise
 * unused by this path.
 */
async function recordNotification(
  admin: AdminClient,
  args: {
    recipientId: string;
    eventType: string;
    title: string;
    body: string | null;
    url: string | null;
  }
): Promise<string | null> {
  const { data, error } = await admin
    .from("notifications")
    .insert({
      recipient_id: args.recipientId,
      tier: "tier1",
      event_type: args.eventType,
      title: args.title,
      body: args.body,
      url: args.url,
      slack_channel: "dm",
    })
    .select("id")
    .single();

  if (error) {
    console.error("[slack/broadcast] notification insert failed", error);
    return null;
  }
  return (data as { id: string }).id;
}

async function stampOutcome(
  admin: AdminClient,
  notificationId: string,
  outcome: DeliveryOutcome
): Promise<void> {
  const { error } = await admin
    .from("notifications")
    .update({
      slack_attempts: 1,
      slack_sent_at: outcome.ok ? new Date().toISOString() : null,
      slack_message_ts: outcome.ts ?? null,
      slack_error: outcome.ok ? null : outcome.error ?? "unknown",
    })
    .eq("id", notificationId);
  if (error) {
    console.error("[slack/broadcast] outcome stamp failed", error);
  }
}
