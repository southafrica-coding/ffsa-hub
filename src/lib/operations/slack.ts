// Operations ↔ Slack: reading the maintenance request form, the 07:00
// messages, Tuesday's weekly summary, the meeting recap, and the ⋯ menu.
//
// Reads use the ADMIN client (no logged-in user). Slack failures are
// reported back, never thrown into the cron.

import { after, NextResponse } from "next/server";
import * as slack from "@/lib/slack/client";
import { isOpsTeam } from "@/lib/operations/access";
import {
  addUpdates,
  createItemFromSlack,
  getItem,
  getSettings,
  getUserBrief,
  claimReminder,
  lastDigest,
  listClosedSince,
  listOpenItems,
  logDigest,
  updateSettings,
} from "@/services/operations";
import { AREAS, STATUS_LABEL, isStatus, type OpsItem } from "./areas";
import { applyChange, displayName, dm, toItem, type Actor } from "./change";
import { dayLabel, meetingWeek, sastDate, sastMidnight } from "./dates";
import {
  OPS_ITEM_ACTION,
  OPS_UPDATE_VIEW,
  esc,
  morningMessage,
  personalMessage,
  recapMessage,
  reminderFor,
  summariseWeek,
  weeklyMessage,
  type Message,
} from "./messages";
import { blocksToText, parseMaintenanceRequest, titleFromIssue } from "./parse-request";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const DAY_MS = 24 * 3600_000;

// ── intake: the Slack maintenance form ──────────────────────

export type ImportResult = { imported: number; seen: number; error?: string };

/**
 * Turn new posts in the request channel into items. Safe to run any time:
 * a post already imported is skipped. First run looks back 7 days.
 * The bot must be in the channel with groups:history (private channel).
 */
export async function importMaintenanceRequests(admin: Client, now = new Date()): Promise<ImportResult> {
  const { data: settings } = await getSettings(admin);
  const channel = settings?.maintenance_intake_channel as string | null;
  if (!channel) return { imported: 0, seen: 0, error: "No request channel set" };

  const oldest = (settings?.last_intake_ts as string | null) ?? String((now.getTime() - 7 * DAY_MS) / 1000);
  const messages: { ts: string; text?: string; blocks?: unknown[]; subtype?: string }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    let res;
    try {
      res = await slack.conversationHistory({ channel, oldest, cursor });
    } catch (err) {
      return { imported: 0, seen: 0, error: err instanceof Error ? err.message : "Slack unreachable" };
    }
    if (!res.ok) return { imported: 0, seen: 0, error: `Slack said ${res.error}` };
    messages.push(...(res.messages ?? []));
    cursor = res.response_metadata?.next_cursor || undefined;
    if (!res.has_more || !cursor) break;
  }

  messages.sort((a, b) => Number(a.ts) - Number(b.ts));
  const names = new Map<string, { userId: string | null; name: string | null }>();
  let imported = 0;
  let newest = oldest;

  for (const m of messages) {
    if (Number(m.ts) > Number(newest)) newest = m.ts;
    if (m.subtype && m.subtype !== "bot_message") continue; // joins, edits…
    const parsed = parseMaintenanceRequest(m.text ?? "") ?? parseMaintenanceRequest(blocksToText(m.blocks));
    if (!parsed) continue;

    let who = { userId: null as string | null, name: parsed.requesterName };
    if (parsed.requesterSlackId) {
      if (!names.has(parsed.requesterSlackId)) names.set(parsed.requesterSlackId, await whoIs(admin, parsed.requesterSlackId));
      const found = names.get(parsed.requesterSlackId)!;
      who = { userId: found.userId, name: found.name ?? parsed.requesterName };
    }

    const { data, error } = await createItemFromSlack(admin, {
      area: "maintenance",
      title: titleFromIssue(parsed.issue),
      details: parsed.issue,
      location: parsed.location,
      source: "slack",
      requested_by_name: who.name,
      requested_by_slack_id: parsed.requesterSlackId,
      requested_by_user_id: who.userId,
      slack_channel: channel,
      slack_ts: m.ts,
      created_at: new Date(Number(m.ts) * 1000).toISOString(),
    });
    if (error) {
      console.error("[operations] import insert failed", error.message);
      continue;
    }
    const id = (data as { id: string }[] | null)?.[0]?.id;
    if (id) {
      imported += 1;
      await addUpdates(admin, [{ item_id: id, author_user_id: who.userId, author_name: who.name, kind: "created", via: "slack" }]);
    }
  }

  if (newest !== oldest) await updateSettings(admin, { last_intake_ts: newest });
  return { imported, seen: messages.length };
}

export async function whoIs(admin: Client, slackUserId: string): Promise<{ userId: string | null; name: string | null }> {
  const { data } = await admin
    .from("users")
    .select("id, display_name, person:people(first_name, last_name)")
    .eq("slack_user_id", slackUserId)
    .maybeSingle();
  if (data) return { userId: data.id, name: displayName(data) };
  try {
    const info = await slack.getUserInfo(slackUserId);
    const p = info.user?.profile;
    return { userId: null, name: p?.real_name || p?.display_name || null };
  } catch {
    return { userId: null, name: null };
  }
}

// ── the 07:00 messages ──────────────────────────────────────

async function post(channel: string, message: Message) {
  const res = await slack.postMessage({ channel, ...message });
  if (!res.ok) throw new Error(`postMessage ${channel}: ${res.error}`);
  return res.ts ?? null;
}

const asItems = (rows: unknown) => ((rows ?? []) as Parameters<typeof toItem>[0][]).map(toItem);

/** Area channel messages, then personal reminders. Mon–Fri, 07:00 SAST. */
export async function sendMorning(admin: Client, now = new Date()) {
  const intake = await importMaintenanceRequests(admin, now);
  const { data: settings } = await getSettings(admin);
  const channels = (settings?.area_channels ?? {}) as Record<string, string>;
  const areas: Record<string, string> = {};

  for (const { key } of AREAS) {
    const channel = channels[key];
    if (!channel) continue;
    // Maintenance has its own follow-up (maintenance-slack.ts) once its channel is set.
    if (key === "maintenance" && settings?.maintenance_followup_channel) continue;
    try {
      const { data: last } = await lastDigest(admin, "morning", key);
      const since = last?.sent_at ? new Date(last.sent_at) : new Date(now.getTime() - DAY_MS);
      const [{ data: open }, { data: closed }] = await Promise.all([
        listOpenItems(admin, { area: key }),
        listClosedSince(admin, since.toISOString(), { area: key }),
      ]);
      const msg = morningMessage(key, [...asItems(open), ...asItems(closed)], since, now);
      if (!msg) {
        areas[key] = "quiet";
        continue;
      }
      const ts = await post(channel, msg);
      await logDigest(admin, { kind: "morning", area: key, channel, slack_ts: ts });
      areas[key] = "sent";
    } catch (err) {
      console.error("[operations] morning failed", key, err);
      areas[key] = err instanceof Error ? err.message : "failed";
    }
  }

  const reminders = await sendReminders(admin, now);
  return { intake, areas, reminders };
}

/**
 * A DM only when something with your name on it is due tomorrow, due
 * today, or was due yesterday (each sent once). It lists the rest of your
 * open items underneath so it's one message, not several.
 */
export async function sendReminders(admin: Client, now = new Date()) {
  const today = sastDate(now);
  const { data } = await admin
    .from("ops_items")
    .select("*, owner:users!ops_items_owner_user_id_fkey(display_name, slack_user_id)")
    .is("closed_at", null)
    .not("owner_user_id", "is", null);
  const byOwner = new Map<string, OpsItem[]>();
  for (const it of asItems(data)) {
    const list = byOwner.get(it.owner_user_id!) ?? [];
    list.push(it);
    byOwner.set(it.owner_user_id!, list);
  }

  let sent = 0;
  for (const [userId, items] of byOwner) {
    const due: OpsItem[] = [];
    for (const it of items) {
      const kind = reminderFor(it, today);
      if (kind && (await claimReminder(admin, { item_id: it.id, kind, due_on: it.due_on, user_id: userId }))) due.push(it);
    }
    if (due.length === 0) continue;
    const { data: user } = await getUserBrief(admin, userId);
    if (!user?.slack_user_id) continue;
    const first = (displayName(user) ?? "").split(" ")[0] || "there";
    const msg = personalMessage(first, [...due, ...items.filter((i) => !due.includes(i))], now);
    if (msg && (await dm(user.slack_user_id, msg))) sent += 1;
  }
  return { sent };
}

// ── Tuesday 17:00: the week, for Wednesday's meeting ────────

export async function loadWeek(client: Client, now = new Date()) {
  const { from, meetingOn } = meetingWeek(now);
  const start = sastMidnight(from).toISOString();
  const [{ data: open }, { data: closed }] = await Promise.all([
    listOpenItems(client),
    listClosedSince(client, start),
  ]);
  const items = [...asItems(open), ...asItems(closed)];
  return { from, meetingOn, items, weeks: summariseWeek(items, from, now) };
}

export async function sendWeekly(admin: Client, now = new Date()) {
  const intake = await importMaintenanceRequests(admin, now);
  const { data: settings } = await getSettings(admin);
  if (!settings?.ops_channel) return { intake, sent: false, reason: "No ops channel set" };
  const { from, meetingOn, weeks } = await loadWeek(admin, now);
  const ts = await post(settings.ops_channel, weeklyMessage(weeks, from, meetingOn, now));
  await logDigest(admin, { kind: "weekly", channel: settings.ops_channel, slack_ts: ts });
  return { intake, sent: true };
}

/** After the meeting: every item given an owner or date from the meeting page today. */
export async function sendRecap(admin: Client, now = new Date()) {
  const { data: settings } = await getSettings(admin);
  if (!settings?.ops_channel) return { sent: false, error: "No ops channel set" };
  const today = sastDate(now);
  const { data: ups } = await admin
    .from("ops_item_updates")
    .select("item_id")
    .eq("via", "meeting")
    .in("kind", ["assign", "due", "created"])
    .gte("created_at", sastMidnight(today).toISOString());
  const ids = [...new Set(((ups ?? []) as { item_id: string }[]).map((u) => u.item_id))];
  const items = ids.length
    ? asItems(
        (
          await admin
            .from("ops_items")
            .select("*, owner:users!ops_items_owner_user_id_fkey(display_name, slack_user_id)")
            .in("id", ids)
        ).data
      ).filter((i) => i.owner_user_id)
    : [];
  const ts = await post(settings.ops_channel, recapMessage(items, today));
  await logDigest(admin, { kind: "recap", channel: settings.ops_channel, slack_ts: ts });
  return { sent: true, count: items.length };
}

// ── the ⋯ menu and its modal ────────────────────────────────

export type OpsInteraction = {
  type: string;
  user: { id: string };
  trigger_id?: string;
  response_url?: string;
  container?: { channel_id?: string; message_ts?: string };
  channel?: { id: string };
  message?: { ts: string; thread_ts?: string };
  actions?: { action_id: string; selected_option?: { value: string } }[];
  view?: {
    callback_id: string;
    private_metadata: string;
    state: { values: Record<string, Record<string, { value?: string | null; selected_date?: string | null }>> };
  };
};

export const isOpsView = (id?: string) => id === OPS_UPDATE_VIEW;

async function tell(responseUrl: string | undefined, text: string) {
  if (!responseUrl) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text }),
  }).catch(() => {});
}

/**
 * The Slack presser as a Hub actor allowed to touch this item, or why not:
 * whoever it was given to, the operations team, and for maintenance the
 * people listed in settings (the 07:00 follow-up group).
 */
export async function actorFor(admin: Client, slackUserId: string, itemId: string): Promise<Actor | { error: string }> {
  const { data: user } = await admin
    .from("users")
    .select("id, display_name, person:people(first_name, last_name)")
    .eq("slack_user_id", slackUserId)
    .maybeSingle();
  if (!user) return { error: "Your Slack isn't linked to a Hub account yet — link it on your Hub profile." };
  const { data: item } = await getItem(admin, itemId);
  if (!item) return { error: "That item is gone." };
  const actor = { userId: user.id, name: displayName(user) };
  if (item.owner_user_id === user.id) return actor;
  if (item.area === "maintenance") {
    const { data: settings } = await getSettings(admin);
    if (((settings?.maintenance_status_user_ids ?? []) as string[]).includes(user.id)) return actor;
  }
  if (await isOpsTeam(admin, user.id)) return actor;
  return { error: "Only the operations team can update this one." };
}

/** A short line under the message so everyone in the channel sees it moved. */
async function announce(channel: string | undefined, threadTs: string | undefined, text: string) {
  if (!channel || !threadTs) return;
  await slack.postMessage({ channel, thread_ts: threadTs, text }).catch(() => {});
}

export function noteModal(itemId: string, title: string, kind: "more_time" | "note", where: { channel?: string; ts?: string }) {
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: `*${esc(title)}*` } },
    {
      type: "input",
      block_id: "note",
      optional: kind === "note" ? false : true,
      label: { type: "plain_text", text: kind === "more_time" ? "What's holding it up? (optional)" : "Note" },
      element: { type: "plain_text_input", action_id: "v", multiline: true, max_length: 2000 },
    },
  ];
  if (kind === "more_time") {
    blocks.push({
      type: "input",
      block_id: "due",
      optional: true,
      label: { type: "plain_text", text: "New date (optional)" },
      element: { type: "datepicker", action_id: "v" },
    });
  }
  return {
    type: "modal",
    callback_id: OPS_UPDATE_VIEW,
    private_metadata: JSON.stringify({ itemId, kind, channel: where.channel, ts: where.ts }),
    title: { type: "plain_text", text: kind === "more_time" ? "Needs more time" : "Add a note" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks,
  };
}

export async function handleOpsInteraction(admin: Client, p: OpsInteraction) {
  // ── modal submitted ──
  if (p.type === "view_submission" && p.view) {
    let meta: { itemId: string; kind: "more_time" | "note"; channel?: string; ts?: string };
    try {
      meta = JSON.parse(p.view.private_metadata);
    } catch {
      return NextResponse.json({});
    }
    const v = p.view.state.values;
    const note = v.note?.v?.value ?? null;
    const due = v.due?.v?.selected_date ?? undefined;
    after(async () => {
      const actor = await actorFor(admin, p.user.id, meta.itemId);
      if ("error" in actor) return;
      const res = await applyChange(admin, {
        itemId: meta.itemId,
        status: meta.kind === "more_time" ? "more_time" : undefined,
        note,
        dueOn: due || undefined,
        actor,
        via: "slack",
      });
      if (res.ok) {
        const what = meta.kind === "more_time" ? `needs more time${due ? ` (now ${dayLabel(due)})` : ""}` : "has a new note";
        await announce(meta.channel, meta.ts, `${esc(actor.name ?? "Someone")}: *${esc(res.item.title)}* ${what}.`);
      }
    });
    return NextResponse.json({}); // closes the modal
  }

  // ── ⋯ menu choice ──
  const choice = p.actions?.[0]?.selected_option?.value ?? "";
  const [what, itemId] = choice.split("|");
  if (p.actions?.[0]?.action_id !== OPS_ITEM_ACTION || !itemId || what === "open") return NextResponse.json({});

  const channel = p.container?.channel_id ?? p.channel?.id;
  const ts = p.message?.thread_ts ?? p.container?.message_ts ?? p.message?.ts;

  if (what === "more_time" || what === "note") {
    // trigger_id lives 3s: open the modal before ACKing.
    const { data: item } = await getItem(admin, itemId);
    if (item && p.trigger_id) await slack.openView(p.trigger_id, noteModal(itemId, item.title, what, { channel, ts }));
    return NextResponse.json({});
  }
  if (!isStatus(what)) return NextResponse.json({});

  after(async () => {
    const actor = await actorFor(admin, p.user.id, itemId);
    if ("error" in actor) return tell(p.response_url, actor.error);
    const res = await applyChange(admin, { itemId, status: what, actor, via: "slack" });
    if (!res.ok) return tell(p.response_url, `Couldn't update it: ${res.error}`);
    await announce(channel, ts, `${esc(actor.name ?? "Someone")}: *${esc(res.item.title)}* → ${STATUS_LABEL[what]}.`);
  });
  return NextResponse.json({});
}
