// In-memory WhatsAppStore for tests and the screenshot harness. Mirrors the
// rules of supabase-store.ts and migration 396 (unique wamid, forward-only
// statuses, the bump function). Fake data only — never a real number.

import { furthestStatus, statusesThatCanBecome, type OutboundStatus } from "../rules";
import type { MessageRow, StatusInput, ThreadRow, WhatsAppStore } from "../store";

export type MemoryStore = WhatsAppStore & {
  threads: ThreadRow[];
  messages: MessageRow[];
  statusEvents: StatusInput[];
  /** e164 → contact id, standing in for contact_phones + org_people. */
  contacts: Map<string, string>;
};

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${(counter += 1).toString().padStart(4, "0")}`;

export function memoryStore(orgId: string | null = "org-missio"): MemoryStore {
  const threads: ThreadRow[] = [];
  const messages: MessageRow[] = [];
  const statusEvents: StatusInput[] = [];
  const contacts = new Map<string, string>();

  const findThread = async (org: string, e164: string) => threads.find((t) => t.org_id === org && t.phone_e164 === e164) ?? null;

  function apply(message: MessageRow, status: OutboundStatus, at: string | null, error?: { code: number | null; title: string | null }) {
    if (!statusesThatCanBecome(status).includes(message.status as OutboundStatus)) return;
    message.status = status;
    message.status_at = at;
    if (status === "failed" && error) {
      message.error_code = error.code;
      message.error_title = error.title;
    }
  }

  return {
    threads,
    messages,
    statusEvents,
    contacts,
    async missioOrgId() {
      return orgId;
    },
    async matchContact(_org, e164) {
      return contacts.get(e164) ?? null;
    },
    findThread,
    async ensureThread({ orgId: org, e164, waId, contactId, profileName }) {
      let thread = await findThread(org, e164);
      if (!thread) {
        const now = new Date().toISOString();
        thread = {
          id: nextId("thread"),
          org_id: org,
          contact_id: contactId,
          phone_e164: e164,
          wa_id: waId,
          profile_name: profileName,
          last_inbound_at: null,
          last_outbound_at: null,
          last_message_at: null,
          last_message_id: null,
          last_preview: null,
          last_direction: null,
          unread_count: 0,
          last_read_at: null,
          opted_out_at: null,
          opt_changed_at: null,
          created_at: now,
          updated_at: now,
        };
        threads.push(thread);
      } else {
        if (!thread.contact_id && contactId) thread.contact_id = contactId;
        if (profileName) thread.profile_name = profileName;
      }
      return thread;
    },
    async insertInbound(input) {
      if (messages.some((m) => m.wamid === input.wamid)) return { inserted: false, id: null };
      const row: MessageRow = {
        id: nextId("msg"),
        org_id: input.orgId,
        thread_id: input.threadId,
        direction: "in",
        kind: input.kind,
        wa_type: input.waType,
        body: input.body,
        template_name: null,
        template_language: null,
        template_vars: null,
        wamid: input.wamid,
        status: "received",
        error_code: null,
        error_title: null,
        opt_change: input.optChange,
        sent_by: null,
        sent_at: input.at,
        status_at: null,
        created_at: new Date().toISOString(),
      };
      messages.push(row);
      return { inserted: true, id: row.id };
    },
    async insertOutbound(input) {
      const row: MessageRow = {
        id: nextId("msg"),
        org_id: input.orgId,
        thread_id: input.threadId,
        direction: "out",
        kind: input.kind,
        wa_type: input.kind,
        body: input.body,
        template_name: input.templateName,
        template_language: input.templateLanguage,
        template_vars: input.templateVars,
        wamid: null,
        status: "pending",
        error_code: null,
        error_title: null,
        opt_change: null,
        sent_by: input.sentBy,
        sent_at: input.at,
        status_at: null,
        created_at: input.at,
      };
      messages.push(row);
      return row;
    },
    async bumpThread(threadId, input) {
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return;
      const later = (a: string | null, b: string) => (!a || Date.parse(b) >= Date.parse(a) ? b : a);
      if (input.direction === "in") {
        thread.last_inbound_at = later(thread.last_inbound_at, input.at);
        thread.unread_count += 1;
      } else {
        thread.last_outbound_at = later(thread.last_outbound_at, input.at);
      }
      if (!thread.last_message_at || Date.parse(input.at) >= Date.parse(thread.last_message_at)) {
        thread.last_message_at = input.at;
        thread.last_message_id = input.messageId;
        thread.last_preview = input.preview;
        thread.last_direction = input.direction;
      }
      if (input.optChange && (!thread.opt_changed_at || Date.parse(input.at) >= Date.parse(thread.opt_changed_at))) {
        thread.opted_out_at = input.optChange === "opt_out" ? input.at : null;
        thread.opt_changed_at = input.at;
      }
    },
    async acceptOutbound(messageId, wamid) {
      const message = messages.find((m) => m.id === messageId)!;
      if (message.status === "pending") {
        message.wamid = wamid;
        message.status = "accepted";
      }
      const early = statusEvents.filter((e) => e.wamid === wamid);
      const best = furthestStatus(early.map((e) => e.status));
      if (best) {
        const event = early.find((e) => e.status === best)!;
        apply(message, best, event.at, { code: event.errorCode, title: event.errorTitle });
      }
      return message;
    },
    async failOutbound(messageId, error) {
      const message = messages.find((m) => m.id === messageId)!;
      message.status = "failed";
      message.error_code = error.code;
      message.error_title = error.title;
      return message;
    },
    async recordStatus(input) {
      if (!statusEvents.some((e) => e.wamid === input.wamid && e.status === input.status)) statusEvents.push(input);
      const message = messages.find((m) => m.wamid === input.wamid && m.org_id === input.orgId && m.direction === "out");
      if (message) apply(message, input.status, input.at, { code: input.errorCode, title: input.errorTitle });
    },
  };
}
