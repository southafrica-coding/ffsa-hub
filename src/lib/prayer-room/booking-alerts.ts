// Prayer Room ← Space Bookings: Slack DM alerts.
//
// Each open block-out suggestion (see services/prayer-room-booking-suggestions)
// is DM'd once to every chosen manager (prayer_room_settings.
// booking_alert_user_ids) with a "move sets to" dropdown and a one-click
// "Block out & notify". Whoever acts first — in Slack or in the Hub — handles
// it, and every recipient's DM is rewritten to say so (migration 232).
//
// syncBookingAlerts() is idempotent: call it after anything that can change
// the suggestions (a booking created / approved / moved, a block-out added).
// All reads/writes use the ADMIN client — the alerts table is server-only.

import crypto from "node:crypto";
import * as slack from "@/lib/slack/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { dateRangeLabel, timeRangeLabel } from "@/lib/bookings/dates";
import {
  getBookingSuggestions,
  getMoveToVenues,
  type BookingSuggestion,
} from "@/services/prayer-room-booking-suggestions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ffsahub.com";
const MANAGE_URL = `${APP_URL}/prayer-room?tab=manage`;

export const ACTION_APPLY = "pr_alert_apply";
export const ACTION_DISMISS = "pr_alert_dismiss";
export const ACTION_MOVE = "pr_alert_move";
export const ACTION_OPEN = "pr_alert_open";
export const VIEW_OTHER = "pr_alert_other";
export const OTHER_VALUE = "__other__";

/** A suggestion + its exact slots: a moved booking becomes a new alert. */
export function alertKeyOf(s: BookingSuggestion): string {
  const fp = crypto
    .createHash("sha1")
    .update(s.occurrences.map((o) => `${o.bookingId}:${o.signature}`).join(","))
    .digest("hex")
    .slice(0, 12);
  return `${s.key}|${fp}`;
}
export const suggestionKeyOf = (alertKey: string) => alertKey.split("|")[0];

const slotLine = (o: { date: string; endDate: string; startTime: string | null; endTime: string | null }) =>
  `${dateRangeLabel(o.date, o.endDate === o.date ? null : o.endDate)} · ${
    o.startTime && o.endTime ? timeRangeLabel(o.startTime, o.endTime) : "all day"
  }`;

// ── message rendering ───────────────────────────────────────

function alertMessage(s: BookingSuggestion, alertKey: string, venues: string[]) {
  const title = `🏛️ Auditorium booked over devo sets — ${s.title}`;
  const who = [s.bookedBy && `booked by ${s.bookedBy}`, s.ministry].filter(Boolean).join(" · ");
  const dates = s.occurrences.slice(0, 4).map(slotLine);
  if (s.occurrences.length > 4) dates.push(`+ ${s.occurrences.length - 4} more weekly dates`);
  const sets = s.affected
    .slice(0, 8)
    .map((a) => `• ${dateRangeLabel(a.date, null)} ${timeRangeLabel(a.startTime, a.endTime)} — ${a.title}${a.owner ? ` (${a.owner})` : ""}`);
  if (s.affected.length > 8) sets.push(`• + ${s.affected.length - 8} more`);

  const options = [...venues, ""].map((v) =>
    v
      ? { text: { type: "plain_text", text: v.slice(0, 75) }, value: v.slice(0, 150) }
      : { text: { type: "plain_text", text: "Other… (type it)" }, value: OTHER_VALUE }
  );

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*🏛️ Auditorium booked over devo sets*\n*${s.title}*${who ? ` — ${who}` : ""}\n${dates.join("\n")}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${s.affected.length} devo set${s.affected.length === 1 ? "" : "s"} affected:*\n${sets.join("\n")}`,
      },
    },
    {
      type: "actions",
      block_id: "pr_alert",
      elements: [
        {
          type: "static_select",
          action_id: ACTION_MOVE,
          placeholder: { type: "plain_text", text: "Move sets to…" },
          options: options.slice(0, 100),
        },
        {
          type: "button",
          action_id: ACTION_APPLY,
          style: "primary",
          text: { type: "plain_text", text: "Block out & notify" },
          value: alertKey,
        },
        {
          type: "button",
          action_id: ACTION_OPEN,
          text: { type: "plain_text", text: "Open in Hub" },
          url: MANAGE_URL,
        },
        {
          type: "button",
          action_id: ACTION_DISMISS,
          text: { type: "plain_text", text: "Dismiss" },
          value: alertKey,
          confirm: {
            title: { type: "plain_text", text: "Dismiss this booking?" },
            text: { type: "plain_text", text: "The devo sets stay where they are. It only comes back if the booking's date or time changes." },
            confirm: { type: "plain_text", text: "Dismiss" },
            deny: { type: "plain_text", text: "Cancel" },
          },
        },
      ],
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: "Blocking out posts to #devo-sets and DMs the team, like any block-out." }],
    },
  ];
  return { text: title, blocks };
}

function resolvedMessage(title: string, line: string) {
  return {
    text: `${line} — ${title}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*🏛️ Auditorium booking — ${title}*\n${line}` } },
      { type: "context", elements: [{ type: "mrkdwn", text: `<${MANAGE_URL}|Open Prayer Room → Manage>` }] },
    ],
  };
}

// ── recipients ──────────────────────────────────────────────

export async function getAlertRecipientIds(admin: Client): Promise<string[]> {
  const { data } = await admin.from("prayer_room_settings").select("booking_alert_user_ids").limit(1).maybeSingle();
  return ((data?.booking_alert_user_ids as string[] | null) ?? []).filter(Boolean);
}

// ── sync ────────────────────────────────────────────────────

type AlertRow = {
  id: string;
  alert_key: string;
  suggestion_key: string;
  title: string;
  recipient_user_id: string;
  slack_channel: string;
  slack_ts: string;
  status: string;
};

/**
 * Post a DM for every new suggestion to every recipient, and close DMs whose
 * suggestion has gone away (cancelled, moved, or blocked out by hand).
 * Never throws — Slack trouble must not break the booking that triggered it.
 */
export async function syncBookingAlerts(): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) return;
  try {
    const admin = createAdminClient() as Client;
    const [{ suggestions }, venues, recipientIds, openRes] = await Promise.all([
      getBookingSuggestions(admin),
      getMoveToVenues(admin),
      getAlertRecipientIds(admin),
      admin.from("prayer_room_booking_alerts").select("*").eq("status", "open"),
    ]);
    const open = (openRes.data ?? []) as AlertRow[];

    const { data: people } = recipientIds.length
      ? await admin.from("users").select("id, slack_user_id").in("id", recipientIds)
      : { data: [] };
    const slackIdOf = new Map(
      ((people ?? []) as { id: string; slack_user_id: string | null }[])
        .filter((p) => p.slack_user_id)
        .map((p) => [p.id, p.slack_user_id as string])
    );

    // New alerts → DM each recipient once (claim the row first so two syncs
    // racing can't both post).
    const liveKeys = new Set<string>();
    for (const s of suggestions) {
      const alertKey = alertKeyOf(s);
      liveKeys.add(alertKey);
      const message = alertMessage(s, alertKey, venues);
      for (const [userId, slackUserId] of slackIdOf) {
        const { data: claimed } = await admin
          .from("prayer_room_booking_alerts")
          .upsert(
            { alert_key: alertKey, suggestion_key: s.key, title: s.title, recipient_user_id: userId, slack_channel: "", slack_ts: "" },
            { onConflict: "alert_key,recipient_user_id", ignoreDuplicates: true }
          )
          .select("id");
        const rowId = (claimed as { id: string }[] | null)?.[0]?.id;
        if (!rowId) continue; // already sent

        const dm = await slack.openConversation(slackUserId);
        const res = dm.ok && dm.channel?.id ? await slack.postMessage({ channel: dm.channel.id, ...message }) : dm;
        const posted = res as { ok: boolean; channel?: string; ts?: string; error?: string };
        if (posted.ok && posted.channel && posted.ts) {
          await admin.from("prayer_room_booking_alerts").update({ slack_channel: posted.channel, slack_ts: posted.ts }).eq("id", rowId);
        } else {
          console.error("[prayer-room/booking-alerts] DM failed", userId, posted.error);
          await admin.from("prayer_room_booking_alerts").delete().eq("id", rowId); // retry next sync
        }
      }
    }

    // Stale alerts → say why, so nobody acts on an old message.
    const liveSuggestionKeys = new Set(suggestions.map((s) => s.key));
    for (const row of open) {
      if (liveKeys.has(row.alert_key)) continue;
      const line = liveSuggestionKeys.has(row.suggestion_key)
        ? "🔁 This booking changed — use the newer message."
        : "✔️ No longer needed — the booking was cancelled, moved off the devo sets, or blocked out in the Hub.";
      await closeRow(admin, row, row.title || "booking", line);
    }
  } catch (err) {
    console.error("[prayer-room/booking-alerts] sync failed", err);
  }
}

async function closeRow(admin: Client, row: AlertRow, title: string, line: string) {
  if (row.slack_channel && row.slack_ts) {
    await slack
      .updateMessage({ channel: row.slack_channel, ts: row.slack_ts, ...resolvedMessage(title, line) })
      .catch((err) => console.error("[prayer-room/booking-alerts] update failed", err));
  }
  await admin
    .from("prayer_room_booking_alerts")
    .update({ status: "resolved", resolution: line, resolved_at: new Date().toISOString() })
    .eq("id", row.id);
}

/** Rewrite every open DM for a suggestion once someone has handled it. */
export async function resolveBookingAlerts(suggestionKey: string, title: string, line: string): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) return;
  try {
    const admin = createAdminClient() as Client;
    const { data } = await admin
      .from("prayer_room_booking_alerts")
      .select("*")
      .eq("suggestion_key", suggestionKey)
      .eq("status", "open");
    for (const row of (data ?? []) as AlertRow[]) await closeRow(admin, row, title, line);
  } catch (err) {
    console.error("[prayer-room/booking-alerts] resolve failed", err);
  }
}

/** "Jack Kilman" for the "handled by" line. */
export async function displayName(admin: Client, userId: string): Promise<string> {
  const { data } = await admin.from("users").select("first_name, last_name, preferred_name").eq("id", userId).maybeSingle();
  return `${data?.preferred_name || data?.first_name || ""} ${data?.last_name || ""}`.trim() || "someone";
}
