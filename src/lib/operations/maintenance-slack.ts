// Maintenance requests in Slack (migration 405): the button, the form, the
// request post with its WhatsApp copy, the status buttons and dropdowns,
// and the 07:00 follow-up. Messages are built in maintenance.ts.

import { after, NextResponse } from "next/server";
import * as slack from "@/lib/slack/client";
import { addUpdates, createItem, getItem, getSettings, lastDigest, listClosedSince, listOpenItems, logDigest, updateItem, updateSettings } from "@/services/operations";
import { applyChange, dm, toItem } from "./change";
import {
  MAINT_NEW,
  MAINT_NOTE,
  MAINT_PICK,
  MAINT_RULES_VIEW,
  MAINT_SET,
  MAINT_VIEW,
  TO_ITEM_STATUS,
  buttonMessage,
  confirmationMessage,
  crewListText,
  followupMessage,
  isMaintStatus,
  hoursFrom,
  hoursNotice,
  isOutOfHours,
  isUrgency,
  MAINT_LABEL,
  requestForm,
  requestPost,
  rulesView,
  sentView,
  whatsappText,
} from "./maintenance";
import { esc } from "./messages";
import { titleFromIssue } from "./parse-request";
import { actorFor, noteModal, whoIs } from "./slack";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const DAY_MS = 24 * 3600_000;

type SlackFile = { id: string; name?: string; mimetype?: string; url_private_download?: string; url_private?: string };

export type MaintInteraction = {
  type: string;
  user: { id: string; name?: string };
  trigger_id?: string;
  response_url?: string;
  container?: { channel_id?: string; message_ts?: string };
  channel?: { id: string };
  message?: { ts: string };
  actions?: { action_id: string; value?: string; selected_option?: { value: string } }[];
  view?: {
    callback_id: string;
    private_metadata?: string;
    state: {
      values: Record<
        string,
        Record<string, { value?: string | null; selected_option?: { value: string } | null; selected_options?: { value: string }[]; files?: SlackFile[] }>
      >;
    };
  };
};

export const isMaintView = (id?: string) => id === MAINT_VIEW || id === MAINT_RULES_VIEW;

async function tell(responseUrl: string | undefined, text: string) {
  if (!responseUrl) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text }),
  }).catch(() => {});
}

// ── The button ──────────────────────────────────────────────

/** Post (or re-post) the "New maintenance request" button. Pin it by hand. */
export async function postRequestButton(admin: Client): Promise<{ ok: boolean; error?: string }> {
  const { data: settings } = await getSettings(admin);
  const channel = settings?.maintenance_button_channel as string | null;
  if (!channel) return { ok: false, error: "Set the channel for the request button first" };
  const res = await slack.postMessage({ channel, ...buttonMessage() });
  if (!res.ok) return { ok: false, error: `Slack said ${res.error}` };
  await updateSettings(admin, { maintenance_button_ts: res.ts ?? null });
  return { ok: true };
}

// ── Interactions ────────────────────────────────────────────

/** Step 2, with the out-of-hours notice if the crew is off now. */
function formFor(settings: Record<string, unknown> | null, now = new Date()) {
  const hours = hoursFrom(settings?.maintenance_hours);
  return requestForm({
    outOfHours: isOutOfHours(now, hours),
    notice: hoursNotice(settings?.maintenance_hours_notice as string | null, now, hours),
  });
}

export async function handleMaintenanceInteraction(admin: Client, p: MaintInteraction) {
  // ── step 1 done: "I agree" ticked → the form ──
  if (p.type === "view_submission" && p.view?.callback_id === MAINT_RULES_VIEW) {
    if (!(p.view.state.values.agree?.v?.selected_options ?? []).length) {
      return NextResponse.json({ response_action: "errors", errors: { agree: "Tick this once you've read the rules" } });
    }
    const { data: settings } = await getSettings(admin);
    return NextResponse.json({ response_action: "update", view: formFor(settings) });
  }

  // ── step 2: the form was sent ──
  if (p.type === "view_submission" && p.view?.callback_id === MAINT_VIEW) {
    const v = p.view.state.values;
    const issue = (v.issue?.v?.value ?? "").trim();
    const where = (v.where?.v?.value ?? "").trim();
    const urgency = v.urgency?.v?.selected_option?.value ?? null;
    const files = (v.photo?.v?.files ?? []).slice(0, 3);
    const errors: Record<string, string> = {};
    if (issue.length < 3) errors.issue = "Say what's wrong";
    if (!where) errors.where = "Say where it is";
    if (!isUrgency(urgency)) errors.urgency = "Choose how urgent it is";
    if (Object.keys(errors).length) return NextResponse.json({ response_action: "errors", errors });

    const now = new Date();
    const { data: settings } = await getSettings(admin);
    const hours = hoursFrom(settings?.maintenance_hours);
    const ooh = isOutOfHours(now, hours);
    const notice = ooh ? hoursNotice(settings?.maintenance_hours_notice as string | null, now, hours) : null;

    after(() =>
      submitRequest(admin, {
        slackUserId: p.user.id,
        issue,
        where,
        urgency: urgency as string,
        files,
        outOfHours: ooh,
        notice,
        intake: (settings?.maintenance_intake_channel as string | null) ?? null,
        now,
      }).catch((err) => console.error("[maintenance] submit failed", err))
    );
    return NextResponse.json({ response_action: "update", view: sentView(notice) });
  }

  const action = p.actions?.[0];
  if (!action) return NextResponse.json({});
  const actionId = action.action_id;

  // ── the button: the rules first, every time (trigger_id lives 3s) ──
  if (actionId === MAINT_NEW) {
    if (!p.trigger_id) return NextResponse.json({});
    const { data: settings } = await getSettings(admin);
    const rules = (settings?.maintenance_rules as string | null)?.trim();
    const res = await slack.openView(p.trigger_id, rules ? rulesView(rules) : formFor(settings));
    if (!res.ok) console.error("[maintenance] views.open", res.error);
    return NextResponse.json({});
  }

  // ── "Add a note" on the post: the shared note modal ──
  if (actionId === MAINT_NOTE && action.value) {
    const { data: item } = await getItem(admin, action.value);
    if (item && p.trigger_id) {
      await slack.openView(p.trigger_id, noteModal(item.id, item.title, "note", { channel: item.slack_channel ?? undefined, ts: item.slack_ts ?? undefined }));
    }
    return NextResponse.json({});
  }

  // ── a status: a button on the post, or the follow-up's dropdown ──
  if (actionId.startsWith(`${MAINT_SET}:`) || actionId === MAINT_PICK) {
    const value = action.selected_option?.value ?? action.value ?? "";
    const [status, itemId] = value.split("|");
    if (!isMaintStatus(status) || !itemId) return NextResponse.json({});
    after(async () => {
      const actor = await actorFor(admin, p.user.id, itemId);
      if ("error" in actor) return tell(p.response_url, actor.error);
      const res = await applyChange(admin, { itemId, status: TO_ITEM_STATUS[status], actor, via: "slack" });
      if (!res.ok) return tell(p.response_url, `Couldn't update it: ${res.error}`);
      // A line in the request's thread, so everyone sees it moved.
      if (res.item.slack_channel && res.item.slack_ts) {
        await slack
          .postMessage({ channel: res.item.slack_channel, thread_ts: res.item.slack_ts, text: `${esc(actor.name ?? "Someone")} set this to *${MAINT_LABEL[status]}*.` })
          .catch(() => {});
      }
    });
    return NextResponse.json({});
  }

  return NextResponse.json({}); // "Open in Hub" is a link
}

// ── A request comes in ──────────────────────────────────────

async function submitRequest(
  admin: Client,
  r: {
    slackUserId: string;
    issue: string;
    where: string;
    urgency: string;
    files: SlackFile[];
    outOfHours: boolean;
    notice: string | null;
    intake: string | null;
    now: Date;
  }
) {
  const who = await whoIs(admin, r.slackUserId);
  const { data: created, error } = await createItem(admin, {
    area: "maintenance",
    title: titleFromIssue(r.issue),
    details: r.issue,
    location: r.where,
    source: "slack",
    requested_by_name: who.name,
    requested_by_slack_id: r.slackUserId,
    requested_by_user_id: who.userId,
    urgency: r.urgency,
    photo_count: r.files.length,
    out_of_hours: r.outOfHours,
    created_at: r.now.toISOString(),
  });
  if (error || !created) {
    console.error("[maintenance] insert failed", error?.message);
    await dm(r.slackUserId, {
      text: "Sorry, your maintenance request didn't go through. Please try again.",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: `Sorry, your maintenance request didn't go through. Please try again.\n> ${esc(r.issue)}` } }],
    });
    return;
  }
  const id = (created as { id: string }).id;
  await addUpdates(admin, [{ item_id: id, author_user_id: who.userId, author_name: who.name, kind: "created", via: "slack" }]);

  const { data: row } = await getItem(admin, id);
  const item = toItem(row);

  // The post for the team, then its thread: the WhatsApp copy and the photos.
  if (r.intake) {
    const posted = await slack.postMessage({ channel: r.intake, ...requestPost(item) }).catch((err) => {
      console.error("[maintenance] post failed", err);
      return null;
    });
    if (posted?.ok && posted.ts) {
      await updateItem(admin, id, { slack_channel: r.intake, slack_ts: posted.ts });
      await slack.postMessage({ channel: r.intake, thread_ts: posted.ts, text: esc(whatsappText(item)) }).catch(() => {});
      let shared = 0;
      for (const f of r.files) {
        const url = f.url_private_download ?? f.url_private;
        if (!url) continue;
        try {
          const data = await slack.downloadFile(url);
          const up = await slack.uploadFile({ channel: r.intake, thread_ts: posted.ts, filename: f.name ?? "photo.jpg", data });
          if (up.ok) shared += 1;
          else console.error("[maintenance] photo upload", up.error);
        } catch (err) {
          console.error("[maintenance] photo", err);
        }
      }
      if (shared !== item.photo_count) {
        // Say what's really in the thread.
        await updateItem(admin, id, { photo_count: shared });
        await slack.updateMessage({ channel: r.intake, ts: posted.ts, ...requestPost({ ...item, photo_count: shared }) }).catch(() => {});
      }
    } else if (posted) {
      console.error("[maintenance] post", posted.error);
    }
  }

  await dm(r.slackUserId, confirmationMessage(item, r.notice));
}

// ── 07:00 Mon–Fri: the follow-up ────────────────────────────

export async function sendMaintenanceFollowup(admin: Client, now = new Date()) {
  const { data: settings } = await getSettings(admin);
  const channel = settings?.maintenance_followup_channel as string | null;
  if (!channel) return { sent: false, reason: "No follow-up channel set" };

  const { data: last } = await lastDigest(admin, "followup");
  const since = last?.sent_at ? new Date(last.sent_at) : new Date(now.getTime() - DAY_MS);
  const [{ data: open }, { data: closed }] = await Promise.all([
    listOpenItems(admin, { area: "maintenance" }),
    listClosedSince(admin, since.toISOString(), { area: "maintenance" }),
  ]);
  const items = ((open ?? []) as Parameters<typeof toItem>[0][]).map(toItem);
  const finished = ((closed ?? []) as Parameters<typeof toItem>[0][]).map(toItem).filter((i) => i.status === "done");

  const res = await slack.postMessage({ channel, ...followupMessage(items, finished, now) });
  if (!res.ok) throw new Error(`follow-up: ${res.error}`);
  const crew = crewListText(items, now);
  if (crew && res.ts) await slack.postMessage({ channel, thread_ts: res.ts, text: esc(crew) }).catch(() => {});
  await logDigest(admin, { kind: "followup", channel, slack_ts: res.ts ?? null });
  return { sent: true, active: items.length };
}
