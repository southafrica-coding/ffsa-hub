// ────────────────────────────────────────────────────────────
// Missio WhatsApp — what the API returns to the inbox
// ────────────────────────────────────────────────────────────
// Client-safe. No token, secret or raw Graph payload ever appears here.

import type { MessageStatus, OptChange, TemplateView } from "./rules";

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
};

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
