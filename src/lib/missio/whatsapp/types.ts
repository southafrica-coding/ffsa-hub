// ────────────────────────────────────────────────────────────
// Missio WhatsApp — what the API returns to the inbox
// ────────────────────────────────────────────────────────────
// Client-safe. No token, secret or raw Graph payload ever appears here.

import type { MessageStatus, OptChange, TemplateView } from "./rules";
import type { BotHandoffReason, BotMode } from "./store";

/**
 * ready          sending works
 * not_configured the WhatsApp settings aren't on the server yet (reads still work)
 * not_installed  database update 396 hasn't been applied
 */
export type WhatsAppSetup = "ready" | "not_configured" | "not_installed";

export type ThreadSummary = {
  id: string;
  /** org_people id when the number belongs to exactly one person in Missio. */
  personId: string | null;
  name: string | null;
  phone: string;
  /** The name they use on WhatsApp, when they've written to us. */
  profileName: string | null;
  lastAt: string | null;
  lastPreview: string | null;
  lastDirection: "in" | "out" | null;
  lastStatus: MessageStatus | null;
  unread: number;
  optedOut: boolean;
  /** The menu bot on this thread. Null until database update 397 is applied. */
  bot?: ThreadBot | null;
  /** New serving interests from this thread ("Serve" badge). */
  serving?: number;
};

/** Who has the chat. */
export type ThreadBot = {
  mode: BotMode;
  reason: BotHandoffReason | null;
  /** The bot is mid-flow (a menu or a serving question is open). */
  active: boolean;
  /** The flow that's open, e.g. "serve". */
  flow: string | null;
};

export type ServingInterestView = {
  id: string;
  teams: string[];
  availability: string | null;
  experience: string | null;
  note: string | null;
  status: "new" | "contacted" | "placed" | "closed";
  at: string;
};

export type InboxResponse = { setup: WhatsAppSetup; threads: ThreadSummary[] };

export type MessageView = {
  id: string;
  direction: "in" | "out";
  kind: "text" | "template" | "placeholder";
  body: string;
  templateName: string | null;
  status: MessageStatus;
  error: string | null;
  at: string;
  optChange: OptChange | null;
  /** The menu sent it, not a pastor. */
  bot?: boolean;
};

export type ThreadBotDetail = ThreadBot & {
  pausedAt: string | null;
  /** Plain words for the pastor: "Bot is asking which team", "A pastor has this chat". */
  statusLine: string;
};

export type ThreadResponse = {
  setup: WhatsAppSetup;
  /** Null when nobody has messaged this person yet. */
  thread: { id: string; unread: number } | null;
  person: { id: string | null; name: string | null; phone: string | null; profileName: string | null };
  /** Why the person can't be messaged at all. */
  blocked: "no_phone" | "bad_phone" | null;
  optedOut: boolean;
  optedOutAt: string | null;
  /** Their last message, which opens the 24-hour window. */
  lastInboundAt: string | null;
  windowEndsAt: string | null;
  messages: MessageView[];
  /** Null until database update 397 is applied, or before anyone has written. */
  bot?: ThreadBotDetail | null;
  serving?: ServingInterestView[];
};

export type BotModeAction = "take_over" | "pause" | "resume";
export type BotModeResponse = { ok: true; bot: { mode: BotMode; reason: BotHandoffReason | null; pausedAt: string | null } };

export type TemplatesResponse =
  | { state: "ok"; templates: TemplateView[] }
  | { state: "not_configured" | "error"; templates: []; message: string };

export type SendResponse = { message: MessageView; threadId: string };

export type WhatsAppErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid_input"
  | "not_found"
  | "no_phone"
  | "bad_phone"
  | "opted_out"
  | "template_required"
  | "template_unavailable"
  | "not_configured"
  | "not_installed"
  | "rate_limited"
  | "send_failed"
  | "server_error";
