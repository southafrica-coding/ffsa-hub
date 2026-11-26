// In-memory WhatsAppStore + BotStore for tests and the screenshot harness.
// Mirrors the rules of supabase-store.ts and migrations 396 / 397 (unique
// wamid, forward-only statuses, the bump function, one open bot session per
// thread, outbox unique on (wamid, purpose, seq)). Fake data only — never a
// real number.

import type { BotMessage, BotStore, ServingInterestRow, SessionRow, Team } from "../bot/types";
import { furthestStatus, statusesThatCanBecome, type OutboundStatus } from "../rules";
import type { MessageRow, StatusInput, ThreadRow, WhatsAppStore } from "../store";

export type OutboxRow = {
  id: string;
  thread_id: string;
  inbound_wamid: string;
  inbound_at: string;
  purpose: "turn" | "reply";
  seq: number;
  payload: BotMessage | null;
  message_id: string | null;
  status: "pending" | "sent" | "failed";
  error_title: string | null;
};

export type MemoryStore = WhatsAppStore &
  BotStore & {
    threads: ThreadRow[];
    messages: MessageRow[];
    statusEvents: StatusInput[];
    /** e164 → contact id, standing in for contact_phones + org_people. */
    contacts: Map<string, string>;
    sessions: SessionRow[];
    outbox: OutboxRow[];
    interests: ServingInterestRow[];
    /** missio_teams. Set teamsError to make the read fail. */
    teams: Team[];
    teamsError: boolean;
    /** contact id → first name. */
    contactNames: Map<string, string>;
  };

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${(counter += 1).toString().padStart(4, "0")}`;

export function memoryStore(orgId: string | null = "org-missio"): MemoryStore {
  const threads: ThreadRow[] = [];
  const messages: MessageRow[] = [];
  const statusEvents: StatusInput[] = [];
  const contacts = new Map<string, string>();
  const sessions: SessionRow[] = [];
  const outbox: OutboxRow[] = [];
  const interests: ServingInterestRow[] = [];
  const contactNames = new Map<string, string>();
  const state = { teams: [] as Team[], teamsError: false };

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

  const open = (threadId: string) => sessions.find((x) => x.thread_id === threadId && !x.closed_at) ?? null;

  return {
    threads,
    messages,
    statusEvents,
    contacts,
    sessions,
    outbox,
    interests,
    contactNames,
    get teams() {
      return state.teams;
    },
    set teams(value: Team[]) {
      state.teams = value;
    },
    get teamsError() {
      return state.teamsError;
    },
    set teamsError(value: boolean) {
      state.teamsError = value;
    },
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
          bot_mode: "on",
          bot_paused_at: null,
          bot_paused_by: null,
          bot_handoff_reason: null,
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
        wa_reply_id: input.replyId ?? null,
        sent_by_bot: false,
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
        wa_type: input.waType ?? input.kind,
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
        wa_reply_id: null,
        sent_by_bot: Boolean(input.sentByBot),
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

    // ── Menu bot (397) ──
    async claimTurn({ threadId, wamid, at }) {
      if (outbox.some((o) => o.inbound_wamid === wamid && o.purpose === "turn")) return false;
      outbox.push({ id: nextId("out"), thread_id: threadId, inbound_wamid: wamid, inbound_at: at, purpose: "turn", seq: 0, payload: null, message_id: null, status: "pending", error_title: null });
      return true;
    },
    async finishTurn(wamid, status, error) {
      const row = outbox.find((o) => o.inbound_wamid === wamid && o.purpose === "turn");
      if (row) {
        row.status = status;
        row.error_title = error?.title ?? null;
      }
    },
    async newerTurnExists(threadId, at, wamid) {
      return outbox.some((o) => o.thread_id === threadId && o.purpose === "turn" && o.inbound_wamid !== wamid && Date.parse(o.inbound_at) > Date.parse(at));
    },
    async getThread(threadId) {
      return threads.find((t) => t.id === threadId) ?? null;
    },
    async openSession(threadId) {
      return open(threadId);
    },
    async saveSession(input) {
      const now = new Date().toISOString();
      const existing = open(input.threadId);
      if (existing) {
        Object.assign(existing, { flow: input.flow, step: input.step, data: input.data, failures: input.failures, last_inbound_wamid: input.wamid, updated_at: now });
        return;
      }
      sessions.push({
        id: nextId("session"),
        org_id: input.orgId,
        thread_id: input.threadId,
        flow: input.flow,
        step: input.step,
        data: input.data,
        failures: input.failures,
        last_inbound_wamid: input.wamid,
        closed_at: null,
        closed_reason: null,
        created_at: now,
        updated_at: now,
      });
    },
    async closeSession(threadId, reason) {
      const existing = open(threadId);
      if (existing) {
        existing.closed_at = new Date().toISOString();
        existing.closed_reason = reason;
      }
    },
    async setBotMode(threadId, input) {
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return;
      const on = input.mode === "on";
      thread.bot_mode = input.mode;
      thread.bot_handoff_reason = on ? null : input.reason;
      thread.bot_paused_at = on ? null : input.at;
      thread.bot_paused_by = on ? null : input.by;
    },
    async enqueueReply(input) {
      if (outbox.some((o) => o.inbound_wamid === input.wamid && o.purpose === "reply" && o.seq === input.seq)) return null;
      const row: OutboxRow = { id: nextId("out"), thread_id: input.threadId, inbound_wamid: input.wamid, inbound_at: input.at, purpose: "reply", seq: input.seq, payload: input.payload, message_id: null, status: "pending", error_title: null };
      outbox.push(row);
      return { id: row.id };
    },
    async finishReply(id, input) {
      const row = outbox.find((o) => o.id === id);
      if (row) {
        row.status = input.status;
        row.message_id = input.messageId;
        row.error_title = input.error?.title ?? null;
      }
    },
    async insertServingInterest(input) {
      const row: ServingInterestRow = { ...input, id: nextId("interest"), note: null, status: "new", createdAt: new Date().toISOString() };
      interests.push(row);
      return { id: row.id };
    },
    async setServingInterestNote(id, note) {
      const row = interests.find((i) => i.id === id);
      if (row) row.note = note;
    },
    async liveTeams() {
      if (state.teamsError) throw new Error("teams read failed");
      return [...state.teams];
    },
    async contactFirstName(contactId) {
      return contactNames.get(contactId) ?? null;
    },
  };
}
