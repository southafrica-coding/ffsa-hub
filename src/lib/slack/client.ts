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
// Slack's Web API is NOT uniformly JSON. The write methods we use
// (chat.postMessage, conversations.open) accept an application/json
// body, but the users.* read methods only accept form encoding — send
// them JSON and Slack never parses the arguments, returning
// `invalid_arguments` as if the call itself were malformed.
//
// This bit us: users.lookupByEmail failed for every single user with
// invalid_arguments while channel posting worked fine, which looked
// for all the world like a scopes or token problem.
const FORM_ENCODED_METHODS = new Set([
  "users.lookupByEmail",
  "users.info",
  "users.list",
]);

async function callSlack<T = Record<string, unknown>>(
  method: string,
  body: Record<string, unknown>
): Promise<SlackResponse<T>> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN not configured");
  }

  const useForm = FORM_ENCODED_METHODS.has(method);

  let contentType: string;
  let payload: string;
  if (useForm) {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined || value === null) continue;
      form.set(key, String(value));
    }
    contentType = "application/x-www-form-urlencoded; charset=utf-8";
    payload = form.toString();
  } else {
    contentType = "application/json; charset=utf-8";
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${SLACK_API_BASE}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": contentType,
    },
    body: payload,
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
// chat.update / views.open
// ------------------------------------------------------------
// Rewrite a message we posted (e.g. an alert DM once someone has
// acted on it), and open a modal from a button click's trigger_id
// (valid for 3s, so call it before ACKing the interaction).
// ────────────────────────────────────────────────────────────

export function updateMessage(args: { channel: string; ts: string; text: string; blocks?: unknown[] }) {
  return callSlack("chat.update", {
    channel: args.channel,
    ts: args.ts,
    text: args.text,
    blocks: args.blocks ?? [],
  });
}

export function openView(triggerId: string, view: unknown) {
  return callSlack("views.open", { trigger_id: triggerId, view });
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
// Resolve a Slack member id (U…) to its profile. Used when someone
// pastes their own member id on /profile so we can echo the matched
// name back at them — linking to a stranger's account by typo is
// otherwise silent and very hard to notice.
// ────────────────────────────────────────────────────────────

export function getUserInfo(slackUserId: string) {
  return callSlack<{
    user?: {
      id: string;
      name?: string;
      deleted?: boolean;
      is_bot?: boolean;
      profile?: { real_name?: string; display_name?: string; email?: string };
    };
  }>("users.info", { user: slackUserId });
}

// ────────────────────────────────────────────────────────────
// users.list
// ------------------------------------------------------------
// One page of workspace members, deactivated ones included
// (`deleted: true`). Used by the daily Slack-deactivation
// reconcile, which needs every member's state in a handful of
// calls rather than one users.info per linked person.
// ────────────────────────────────────────────────────────────

export function listUsers(cursor?: string) {
  return callSlack<{
    members?: Array<{ id: string; deleted?: boolean; is_bot?: boolean }>;
    response_metadata?: { next_cursor?: string };
  }>("users.list", { limit: 200, cursor });
}
