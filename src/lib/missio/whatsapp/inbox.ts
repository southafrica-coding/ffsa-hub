// ────────────────────────────────────────────────────────────
// Missio WhatsApp — the inbox and one thread, as the pastor sees them
// ────────────────────────────────────────────────────────────
// Server only. Reads go through the pastor's own client (RLS: pastors only).
// The person's phone comes from contacts through the service role, after
// the pastor check, exactly as the person profile does.

import { toMissioPerson } from "@/lib/missio/people";
import {
  getWhatsAppMessageStatuses,
  getWhatsAppThreadById,
  getWhatsAppThreadByPhone,
  listMissioNamesByContact,
  listWhatsAppMessages,
  listWhatsAppThreads,
} from "@/services/missio-whatsapp";
import { formatE164, whatsAppE164 } from "./phone";
import { serviceWindowEndsAt, type MessageStatus } from "./rules";
import { isMissingRelation, type ThreadRow } from "./store";
import type { InboxResponse, MessageView, ThreadResponse, ThreadSummary, WhatsAppSetup } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type DbError = { code?: string; message?: string } | null;

export type ReadFailure = { ok: false; status: number; code: "not_found" | "server_error"; error: string };

type NameRow = { id: string; contact_id: string; first_name?: string | null; last_name?: string | null; preferred_name?: string | null };

function nameOf(row: NameRow): string {
  const person = toMissioPerson({
    id: row.id,
    contact_id: row.contact_id,
    campus: "potch",
    status: "active",
    joined_at: null,
    current_stage: null,
    first_name: row.first_name,
    last_name: row.last_name,
    preferred_name: row.preferred_name,
  });
  return person.name;
}

async function namesFor(supabase: Client, orgId: string, contactIds: string[]): Promise<Map<string, { personId: string; name: string }>> {
  const out = new Map<string, { personId: string; name: string }>();
  if (contactIds.length === 0) return out;
  const { data, error } = await listMissioNamesByContact(supabase, orgId, contactIds);
  if (error) {
    console.error("[missio-whatsapp] names failed", (error as DbError)?.code ?? "db error");
    return out;
  }
  for (const row of (data ?? []) as NameRow[]) out.set(row.contact_id, { personId: row.id, name: nameOf(row) });
  return out;
}

export async function loadInbox(supabase: Client, orgId: string, sendReady: boolean): Promise<InboxResponse | ReadFailure> {
  const { data, error } = await listWhatsAppThreads(supabase, orgId);
  if (error) {
    if (isMissingRelation(error)) return { setup: "not_installed", threads: [] };
    console.error("[missio-whatsapp] inbox failed", (error as DbError)?.code ?? "db error");
    return { ok: false, status: 500, code: "server_error", error: "Something went wrong." };
  }
  const threads = (data ?? []) as ThreadRow[];
  const names = await namesFor(supabase, orgId, [...new Set(threads.map((t) => t.contact_id).filter((id): id is string => Boolean(id)))]);

  const lastIds = threads.map((t) => t.last_message_id).filter((id): id is string => Boolean(id));
  const statuses = new Map<string, MessageStatus>();
  if (lastIds.length > 0) {
    const res = await getWhatsAppMessageStatuses(supabase, orgId, lastIds);
    for (const row of (res.data ?? []) as Array<{ id: string; status: MessageStatus }>) statuses.set(row.id, row.status);
  }

  const summaries: ThreadSummary[] = threads.map((t) => {
    const who = t.contact_id ? names.get(t.contact_id) : undefined;
    return {
      id: t.id,
      personId: who?.personId ?? null,
      name: who?.name || null,
      phone: formatE164(t.phone_e164),
      profileName: t.profile_name,
      lastAt: t.last_message_at,
      lastPreview: t.last_preview,
      lastDirection: t.last_direction,
      lastStatus: t.last_message_id ? (statuses.get(t.last_message_id) ?? null) : null,
      unread: t.unread_count,
      optedOut: Boolean(t.opted_out_at),
    };
  });
  return { setup: sendReady ? "ready" : "not_configured", threads: summaries };
}

type MessageDbRow = {
  id: string;
  direction: "in" | "out";
  kind: "text" | "template" | "placeholder";
  body: string;
  template_name: string | null;
  status: MessageStatus;
  error_code: number | null;
  error_title: string | null;
  opt_change: "opt_out" | "opt_in" | null;
  sent_at: string;
};

export function messageView(row: MessageDbRow): MessageView {
  return {
    id: row.id,
    direction: row.direction,
    kind: row.kind,
    body: row.body,
    templateName: row.template_name,
    status: row.status,
    error: row.status === "failed" ? (row.error_title ?? "WhatsApp didn't deliver this.") : null,
    at: row.sent_at,
    optChange: row.opt_change,
  };
}

export type ThreadKey = { personId: string } | { threadId: string };

export type ThreadDeps = {
  supabase: Client;
  orgId: string;
  sendReady: boolean;
  /** RLS read of one Missio person: their contact and name. */
  loadPerson(personId: string): Promise<{ contactId: string; name: string } | { status: number }>;
  /** contacts.phone through the service role, after the pastor check. */
  readPhone(contactId: string): Promise<string | null>;
  now?: Date;
};

function emptyThread(setup: WhatsAppSetup): Omit<ThreadResponse, "person" | "blocked"> {
  return { setup, thread: null, optedOut: false, optedOutAt: null, lastInboundAt: null, windowEndsAt: null, messages: [] };
}

export async function loadThread(deps: ThreadDeps, key: ThreadKey): Promise<ThreadResponse | ReadFailure> {
  const { supabase, orgId } = deps;
  const setup: WhatsAppSetup = deps.sendReady ? "ready" : "not_configured";
  let thread: ThreadRow | null = null;
  let person: ThreadResponse["person"] = { id: null, name: null, phone: null, profileName: null };
  let blocked: ThreadResponse["blocked"] = null;

  if ("personId" in key) {
    const found = await deps.loadPerson(key.personId);
    if ("status" in found) {
      return found.status === 404
        ? { ok: false, status: 404, code: "not_found", error: "Person not found." }
        : { ok: false, status: 500, code: "server_error", error: "Something went wrong." };
    }
    const raw = await deps.readPhone(found.contactId);
    const e164 = whatsAppE164(raw);
    person = { id: key.personId, name: found.name, phone: e164 ? formatE164(e164) : (raw ?? null), profileName: null };
    if (!raw) blocked = "no_phone";
    else if (!e164) blocked = "bad_phone";
    if (!e164) return { ...emptyThread(setup), person, blocked };
    const res = await getWhatsAppThreadByPhone(supabase, orgId, e164);
    if (res.error) {
      if (isMissingRelation(res.error)) return { ...emptyThread("not_installed"), person, blocked };
      return { ok: false, status: 500, code: "server_error", error: "Something went wrong." };
    }
    thread = res.data as ThreadRow | null;
  } else {
    const res = await getWhatsAppThreadById(supabase, orgId, key.threadId);
    if (res.error) {
      if (isMissingRelation(res.error)) return { ...emptyThread("not_installed"), person, blocked: null };
      return { ok: false, status: 500, code: "server_error", error: "Something went wrong." };
    }
    thread = res.data as ThreadRow | null;
    if (!thread) return { ok: false, status: 404, code: "not_found", error: "Conversation not found." };
    const names = thread.contact_id ? await namesFor(supabase, orgId, [thread.contact_id]) : new Map();
    const who = thread.contact_id ? names.get(thread.contact_id) : undefined;
    person = { id: who?.personId ?? null, name: who?.name ?? null, phone: formatE164(thread.phone_e164), profileName: thread.profile_name };
  }

  if (!thread) return { ...emptyThread(setup), person, blocked };
  person.profileName = thread.profile_name;

  const res = await listWhatsAppMessages(supabase, orgId, thread.id);
  if (res.error) {
    console.error("[missio-whatsapp] messages failed", (res.error as DbError)?.code ?? "db error");
    return { ok: false, status: 500, code: "server_error", error: "Something went wrong." };
  }
  const messages = ((res.data ?? []) as MessageDbRow[]).map(messageView).reverse();
  return {
    setup,
    thread: { id: thread.id, unread: thread.unread_count },
    person,
    blocked,
    optedOut: Boolean(thread.opted_out_at),
    optedOutAt: thread.opted_out_at,
    lastInboundAt: thread.last_inbound_at,
    windowEndsAt: serviceWindowEndsAt(thread.last_inbound_at, deps.now),
    messages,
  };
}
