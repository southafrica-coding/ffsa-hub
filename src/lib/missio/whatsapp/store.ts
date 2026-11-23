// ────────────────────────────────────────────────────────────
// Missio WhatsApp — what the webhook and the send route write
// ────────────────────────────────────────────────────────────
// One interface, two implementations: supabase-store.ts (service role,
// migration 396) and testing/memory-store.ts (tests and screenshots).
// Both follow the same rules:
//   - a wamid is stored once; a second delivery changes nothing
//   - statuses only move forward (rules.ts statusesThatCanBecome)
//   - a status that arrives before its message is kept and applied once the
//     message has its wamid
//   - a thread's "last" fields and opt-out follow the newest message by
//     WhatsApp's timestamp, not by arrival order

import type { OptChange, OutboundStatus } from "./rules";

export type ThreadRow = {
  id: string;
  org_id: string;
  contact_id: string | null;
  phone_e164: string;
  wa_id: string;
  profile_name: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_message_at: string | null;
  last_message_id: string | null;
  last_preview: string | null;
  last_direction: "in" | "out" | null;
  unread_count: number;
  last_read_at: string | null;
  opted_out_at: string | null;
  opt_changed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  org_id: string;
  thread_id: string;
  direction: "in" | "out";
  kind: "text" | "template" | "placeholder";
  wa_type: string | null;
  body: string;
  template_name: string | null;
  template_language: string | null;
  template_vars: Record<string, string> | null;
  wamid: string | null;
  status: OutboundStatus | "received";
  error_code: number | null;
  error_title: string | null;
  opt_change: OptChange | null;
  sent_by: string | null;
  sent_at: string;
  status_at: string | null;
  created_at: string;
};

export type InboundInput = {
  orgId: string;
  threadId: string;
  wamid: string;
  kind: "text" | "placeholder";
  waType: string;
  body: string;
  at: string;
  optChange: OptChange | null;
};

export type OutboundInput = {
  orgId: string;
  threadId: string;
  kind: "text" | "template";
  body: string;
  templateName: string | null;
  templateLanguage: string | null;
  templateVars: Record<string, string> | null;
  sentBy: string;
  at: string;
};

export type StatusInput = {
  orgId: string;
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed";
  at: string;
  errorCode: number | null;
  errorTitle: string | null;
};

export type BumpInput = {
  messageId: string;
  direction: "in" | "out";
  at: string;
  preview: string;
  optChange: OptChange | null;
};

/** Thrown when the 396 tables aren't there, so callers answer 503, not 500. */
export class WhatsAppNotInstalledError extends Error {
  constructor() {
    super("missio_whatsapp_not_installed");
    this.name = "WhatsAppNotInstalledError";
  }
}

export interface WhatsAppStore {
  missioOrgId(): Promise<string | null>;
  /** The contact for this number when exactly one Missio person has it. */
  matchContact(orgId: string, e164: string): Promise<string | null>;
  findThread(orgId: string, e164: string): Promise<ThreadRow | null>;
  /** Get or create the thread for a number. Links a contact only if the thread has none. */
  ensureThread(input: { orgId: string; e164: string; waId: string; contactId: string | null; profileName: string | null }): Promise<ThreadRow>;
  /** False when this wamid is already stored. */
  insertInbound(input: InboundInput): Promise<{ inserted: boolean; id: string | null }>;
  insertOutbound(input: OutboundInput): Promise<MessageRow>;
  bumpThread(threadId: string, input: BumpInput): Promise<void>;
  /** Graph accepted it: store the wamid, then apply any status that came first. */
  acceptOutbound(messageId: string, wamid: string): Promise<MessageRow>;
  failOutbound(messageId: string, error: { code: number | null; title: string }): Promise<MessageRow>;
  recordStatus(input: StatusInput): Promise<void>;
}

/** Postgres / PostgREST "that table isn't there". */
export function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "42883" || error.code === "PGRST202") return true;
  return /missio_whatsapp_/.test(error.message ?? "") && /does not exist|schema cache|could not find/i.test(error.message ?? "");
}
