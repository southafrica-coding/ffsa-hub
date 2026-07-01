/**
 * Minimal Slack Web API client.
 *
 * No SDK — just `fetch`. Slack's API is a flat list of POST methods
 * returning JSON. We only need three of them:
 *
 *   • chat.postMessage         — post to a channel or DM
 *   • conversations.open       — open a DM with a user id
 *   • users.lookupByEmail      — map email → Slack user id
 *
 * Auth is a bot token from the `SLACK_BOT_TOKEN` env var, set in
 * Vercel project env (Production + Preview + Development). The
 * token is the OAuth Bot User token (`xoxb-…`) for the FFSA Hub
 * Slack App.
 *
 * All methods return the raw Slack response object as JSON. Slack
 * uses an `ok: boolean` field — callers should check it before
 * relying on other fields. We surface `error` strings as-is.
 */

const SLACK_API_BASE = "https://slack.com/api";

export type SlackResponse<T = unknown> = {
  ok: boolean;
  error?: string;
  warning?: string;
} & T;

/**
 * Shared transport. Throws if `SLACK_BOT_TOKEN` is missing so that
 * callers can decide whether to swallow or surface the error.
 * Network failures surface as plain `Error` from `fetch`.
 */
async function callSlack<T = Record<string, unknown>>(
  method: string,
  body: Record<string, unknown>
): Promise<SlackResponse<T>> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN not configured");
  }

  const res = await fetch(`${SLACK_API_BASE}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  // Slack always returns JSON — even errors are HTTP 200 with ok:false.
  // Network/CDN errors are the only way we'd hit a non-2xx status.
  if (!res.ok) {
    throw new Error(`Slack API ${method} HTTP ${res.status}`);
  }
  return (await res.json()) as SlackResponse<T>;
}

// ────────────────────────────────────────────────────────────
// chat.postMessage
// ------------------------------------------------------------
// Post a message to a channel id (C…) or DM channel id (D…).
// `blocks` is the rich Block Kit payload; `text` is the fallback
// shown in notifications. Always supply both.
// ────────────────────────────────────────────────────────────

export function postMessage(args: {
  channel: string;
  text: string;
  blocks?: unknown[];
  unfurl_links?: boolean;
  thread_ts?: string;
}) {
  return callSlack<{ ts?: string; channel?: string }>("chat.postMessage", {
    channel: args.channel,
    text: args.text,
    blocks: args.blocks,
    // When set, reply inside the originating thread (used by the
    // inbound Q&A bot so channel answers stay tidy).
    thread_ts: args.thread_ts,
    // Disable link unfurling by default — our messages already
    // include explicit buttons, unfurled previews are visual noise.
    unfurl_links: args.unfurl_links ?? false,
  });
}

// ────────────────────────────────────────────────────────────
// conversations.open
// ------------------------------------------------------------
// Open a DM channel with a Slack user id (U…). Returns the
// channel id (D…) which is what postMessage needs.
// ────────────────────────────────────────────────────────────

export function openConversation(slackUserId: string) {
  return callSlack<{ channel?: { id: string } }>("conversations.open", {
    users: slackUserId,
  });
}

// ────────────────────────────────────────────────────────────
// users.lookupByEmail
// ------------------------------------------------------------
// Map an email to a Slack user id. Used by the admin integration
// page to auto-populate users.slack_user_id.
// Returns ok:false with error:"users_not_found" when no match.
// ────────────────────────────────────────────────────────────

export function lookupUserByEmail(email: string) {
  return callSlack<{
    user?: { id: string; profile?: { email?: string; real_name?: string } };
  }>("users.lookupByEmail", { email });
}

// ────────────────────────────────────────────────────────────
// auth.test
// ------------------------------------------------------------
// Cheap ping that confirms the bot token is valid. Used by the
// admin integration page status section.
// ────────────────────────────────────────────────────────────

export function authTest() {
  return callSlack<{
    url?: string;
    team?: string;
    team_id?: string;
    user?: string;
    bot_id?: string;
  }>("auth.test", {});
}

// ────────────────────────────────────────────────────────────
// users.info
// ------------------------------------------------------------
// Fetch a user's display name / email by Slack user id (U…). Used
// by the feedback bot to label reports with a human name.
// ────────────────────────────────────────────────────────────

export function usersInfo(userId: string) {
  return callSlack<{
    user?: {
      id: string;
      real_name?: string;
      profile?: { real_name?: string; display_name?: string; email?: string };
    };
  }>("users.info", { user: userId });
}

// ────────────────────────────────────────────────────────────
// chat.update
// ------------------------------------------------------------
// Edit an already-posted message in place (channel id + ts). Used
// to reflect status changes on #hub-triage briefs when an admin
// taps a button.
// ────────────────────────────────────────────────────────────

export function updateMessage(args: {
  channel: string;
  ts: string;
  text: string;
  blocks?: unknown[];
}) {
  return callSlack<{ ts?: string }>("chat.update", {
    channel: args.channel,
    ts: args.ts,
    text: args.text,
    blocks: args.blocks,
  });
}
