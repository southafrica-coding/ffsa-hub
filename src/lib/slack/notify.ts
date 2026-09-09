/**
 * Slack notification dispatcher — Hub → Slack channel posts.
 *
 * Current scope is deliberately small: exactly three kinds of
 * message reach Slack, all posted to the #ffsa-activity channel
 * (channel id from slack_settings.channel_id, or the
 * SLACK_ACTIVITY_CHANNEL_ID env fallback).
 *
 *   1. form_submitted        — someone fills out a public form
 *   2. ticket_purchased      — someone buys event tickets
 *   3. application_submitted — someone applies to any school/program
 *
 * (1) and (2) ride the existing activity_events pipeline:
 * logActivity() calls dispatchNotification() fire-and-forget after
 * the insert. (3) is NOT part of the CRM activity system (school
 * applications aren't contacts), so the public applications route
 * calls notifyApplicationSubmitted() directly.
 *
 * Failures here are swallowed at the call site (callers wrap in
 * `void notify(...).catch(...)`) so a Slack outage never blocks a
 * user-facing request.
 *
 * NOTE: DMs, per-user routing, and the notifications-table writes
 * designed in migration 069 are intentionally NOT wired yet — this
 * is channel-only until the team decides to broaden scope.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import * as slack from "./client";
import { formatNotification } from "./templates";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ffsahub.com";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

type ActivityEventRow = {
  id: string;
  event_type: string;
  contact_id: string | null;
  related_user_id: string | null;
  related_form_id: string | null;
  payload: Record<string, unknown> | null;
  occurred_at: string;
};

// Only these activity_events event types post to Slack today.
// Everything else logActivity() records is ignored here.
const CHANNEL_EVENT_TYPES = new Set(["form_submitted", "ticket_purchased"]);

// ────────────────────────────────────────────────────────────
// Public entry: dispatchNotification
// ------------------------------------------------------------
// Called fire-and-forget from logActivity() after every
// activity_events insert. Posts a #ffsa-activity message for the
// two in-scope activity event types; ignores all others.
// ────────────────────────────────────────────────────────────

export async function dispatchNotification(args: {
  activityEvent: ActivityEventRow;
}): Promise<void> {
  const event = args.activityEvent;

  if (!CHANNEL_EVENT_TYPES.has(event.event_type)) return;

  // No-op if Slack isn't configured. Warn so a misconfigured
  // environment is visible in logs, but never throw.
  if (!process.env.SLACK_BOT_TOKEN) {
    console.warn("[slack/notify] SLACK_BOT_TOKEN missing — skipping");
    return;
  }

  const admin = createAdminClient();
  const contactName = await fetchContactName(admin, event.contact_id);
  const payload = await enrichPayload(admin, event);
  const url = event.contact_id
    ? `${APP_URL}/contacts/${event.contact_id}`
    : APP_URL;

  const { title, blocks } = formatNotification({
    eventType: event.event_type,
    contactName,
    payload,
    appUrl: url,
  });

  await postToActivityChannel(admin, { title, blocks });
}

// ────────────────────────────────────────────────────────────
// Public entry: notifyApplicationSubmitted
// ------------------------------------------------------------
// Called directly from src/app/api/public/applications/route.ts
// after a successful application insert. School applications are
// not contacts, so they don't flow through logActivity().
// ────────────────────────────────────────────────────────────

export async function notifyApplicationSubmitted(args: {
  applicantName: string | null;
  programName: string;
  programId: string;
  applicantEmail: string | null;
}): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN) {
    console.warn("[slack/notify] SLACK_BOT_TOKEN missing — skipping");
    return;
  }

  const admin = createAdminClient();
  const url = `${APP_URL}/schools/${args.programId}`;

  const { title, blocks } = formatNotification({
    eventType: "application_submitted",
    contactName: args.applicantName,
    payload: {
      program_name: args.programName,
      applicant_email: args.applicantEmail,
    },
    appUrl: url,
  });

  await postToActivityChannel(admin, { title, blocks });
}

// ────────────────────────────────────────────────────────────
// Internal: payload enrichment
// ------------------------------------------------------------
// The activity_events rows carry only minimal payloads (ids), so
// we hydrate the human-readable bits the templates want right
// before formatting:
//   • ticket_purchased → event title (via payload.event_id)
//   • form_submitted   → form name   (via related_form_id)
// ────────────────────────────────────────────────────────────

async function enrichPayload(
  admin: AdminClient,
  event: ActivityEventRow
): Promise<Record<string, unknown> | null> {
  const base = event.payload ?? {};

  if (event.event_type === "ticket_purchased") {
    const eventId = typeof base["event_id"] === "string" ? (base["event_id"] as string) : null;
    if (eventId) {
      const { data } = await admin
        .from("events")
        .select("title")
        .eq("id", eventId)
        .maybeSingle();
      const title = (data as { title: string | null } | null)?.title;
      if (title) return { ...base, event_title: title };
    }
    return base;
  }

  if (event.event_type === "form_submitted" && event.related_form_id) {
    const { data } = await admin
      .from("forms")
      .select("name, slug")
      .eq("id", event.related_form_id)
      .maybeSingle();
    const form = data as { name: string | null; slug: string | null } | null;
    if (form) {
      return { ...base, form_name: form.name, form_slug: form.slug };
    }
    return base;
  }

  return base;
}

// ────────────────────────────────────────────────────────────
// Internal: channel posting
// ────────────────────────────────────────────────────────────

/**
 * Post a message to the #ffsa-activity channel. Channel id comes
 * from slack_settings.channel_id; if the singleton row has no
 * channel_id we fall back to the SLACK_ACTIVITY_CHANNEL_ID env var.
 */
async function postToActivityChannel(
  admin: AdminClient,
  message: { title: string; blocks: unknown[] }
): Promise<void> {
  const channelId = await resolveActivityChannelId(admin);
  if (!channelId) {
    console.warn(
      "[slack/notify] no channel_id configured (slack_settings.channel_id and SLACK_ACTIVITY_CHANNEL_ID both empty) — skipping channel post"
    );
    return;
  }

  try {
    const res = await slack.postMessage({
      channel: channelId,
      text: message.title,
      blocks: message.blocks,
    });
    if (!res.ok) {
      console.error("[slack/notify] postMessage failed", {
        channel: channelId,
        error: res.error,
      });
    }
  } catch (err) {
    console.error("[slack/notify] channel post threw", err);
  }
}

async function resolveActivityChannelId(admin: AdminClient): Promise<string | null> {
  // Prefer the DB-configured channel so the admin page can change
  // it without a redeploy. Fall back to env for bootstrap / testing.
  const { data, error } = await admin
    .from("slack_settings")
    .select("channel_id")
    .eq("id", "global")
    .maybeSingle();
  if (error) {
    console.error("[slack/notify] slack_settings read failed", error);
  }
  const dbChannel = (data as { channel_id: string | null } | null)?.channel_id;
  return dbChannel || process.env.SLACK_ACTIVITY_CHANNEL_ID || null;
}

// ────────────────────────────────────────────────────────────
// Internal: contact name lookup
// ────────────────────────────────────────────────────────────

async function fetchContactName(
  admin: AdminClient,
  contactId: string | null
): Promise<string | null> {
  if (!contactId) return null;
  const { data } = await admin
    .from("contacts")
    .select("first_name, last_name, preferred_name")
    .eq("id", contactId)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
  };
  const first = row.first_name ?? "";
  const last = row.last_name ?? "";
  const joined = `${first} ${last}`.trim();
  return joined.length > 0 ? joined : null;
}
