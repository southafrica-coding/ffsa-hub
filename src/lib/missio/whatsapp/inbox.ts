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
  listOpenBotSessions,
  listServingInterestsForThreads,
  listWhatsAppMessages,
  listWhatsAppThreads,
} from "@/services/missio-whatsapp";
import { AVAILABILITY, botStatusLine, EXPERIENCE } from "./bot/copy";
import { formatE164, whatsAppE164 } from "./phone";
import { serviceWindowEndsAt, type MessageStatus } from "./rules";
import { isMissingColumn, isMissingRelation, type ThreadRow } from "./store";
import type {
  InboxResponse,
  MessageView,
  ServingInterestView,
  ThreadBot,
  ThreadBotDetail,
  ThreadResponse,
  ThreadSummary,
  WhatsAppSetup,
} from "./types";

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

type DbResult = { data: unknown; error: DbError };

/** Read with the 397 columns; if 397 isn't applied yet, read again without them. */
async function withBotColumns(read: (bot: boolean) => Promise<DbResult>): Promise<DbResult & { bot: boolean }> {
  const first = await read(true);
  if (!isMissingColumn(first.error)) return { ...first, bot: true };
  return { ...(await read(false)), bot: false };
}

type SessionLite = { thread_id: string; flow: string; step: string; updated_at: string };
type InterestDb = {
  id: string;
  thread_id: string | null;
  teams: Array<{ id?: string | null; name?: string }> | null;
  availability: string | null;
  experience: string | null;
  note: string | null;
  status: ServingInterestView["status"];
  created_at: string;
};

/** Open sessions and serving interests for these threads. Empty (not an error) when 397 isn't applied. */
async function botExtras(supabase: Client, orgId: string, threadIds: string[], options?: { newOnly?: boolean }) {
  const sessions = new Map<string, SessionLite>();
  const interests: InterestDb[] = [];
  if (threadIds.length === 0) return { sessions, interests };
  const [s, i] = await Promise.all([
    listOpenBotSessions(supabase, orgId, threadIds),
    listServingInterestsForThreads(supabase, orgId, threadIds, options?.newOnly ? { status: "new" } : undefined),
  ]);
  if (s.error) {
    if (!isMissingRelation(s.error)) console.error("[missio-whatsapp] bot sessions failed", (s.error as DbError)?.code ?? "db error");
  } else for (const row of (s.data ?? []) as SessionLite[]) sessions.set(row.thread_id, row);
  if (i.error) {
    if (!isMissingRelation(i.error)) console.error("[missio-whatsapp] serving interests failed", (i.error as DbError)?.code ?? "db error");
  } else interests.push(...((i.data ?? []) as InterestDb[]));
  return { sessions, interests };
}

function threadBot(t: ThreadRow, session: SessionLite | undefined): ThreadBot | null {
  if (!t.bot_mode) return null;
  const active = t.bot_mode === "on" && Boolean(session) && session?.flow !== "rest";
  return { mode: t.bot_mode, reason: t.bot_handoff_reason ?? null, active, flow: active ? (session?.flow ?? null) : null };
}

const titleOf = (list: ReadonlyArray<{ id: string; title: string }>, id: string | null) => (id ? (list.find((x) => x.id === id)?.title ?? id) : null);

export function servingView(row: InterestDb): ServingInterestView {
  return {
    id: row.id,
    teams: (row.teams ?? []).map((t) => t?.name ?? "").filter(Boolean),
    availability: titleOf(AVAILABILITY, row.availability),
    experience: titleOf(EXPERIENCE, row.experience),
    note: row.note,
    status: row.status,
    at: row.created_at,
  };
}

export async function loadInbox(supabase: Client, orgId: string, sendReady: boolean): Promise<InboxResponse | ReadFailure> {
  const { data, error, bot } = await withBotColumns((withBot) => listWhatsAppThreads(supabase, orgId, { bot: withBot }));
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

  const extras = bot ? await botExtras(supabase, orgId, threads.map((t) => t.id), { newOnly: true }) : null;
  const servingCount = new Map<string, number>();
  for (const row of extras?.interests ?? []) {
    if (row.thread_id) servingCount.set(row.thread_id, (servingCount.get(row.thread_id) ?? 0) + 1);
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
      bot: bot ? threadBot(t, extras?.sessions.get(t.id)) : null,
      serving: servingCount.get(t.id) ?? 0,
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
  sent_by_bot?: boolean | null;
};

export function messageView(row: MessageDbRow): MessageView {
  return {
    ...(row.sent_by_bot ? { bot: true } : {}),
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
    const res = await withBotColumns((bot) => getWhatsAppThreadByPhone(supabase, orgId, e164, { bot }));
    if (res.error) {
      if (isMissingRelation(res.error)) return { ...emptyThread("not_installed"), person, blocked };
      return { ok: false, status: 500, code: "server_error", error: "Something went wrong." };
    }
    thread = res.data as ThreadRow | null;
  } else {
    const res = await withBotColumns((bot) => getWhatsAppThreadById(supabase, orgId, key.threadId, { bot }));
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

  const res = await withBotColumns((bot) => listWhatsAppMessages(supabase, orgId, thread.id, { bot }));
  if (res.error) {
    console.error("[missio-whatsapp] messages failed", (res.error as DbError)?.code ?? "db error");
    return { ok: false, status: 500, code: "server_error", error: "Something went wrong." };
  }
  const messages = ((res.data ?? []) as MessageDbRow[]).map(messageView).reverse();

  let botDetail: ThreadBotDetail | null = null;
  let serving: ServingInterestView[] = [];
  if (thread.bot_mode) {
    const extras = await botExtras(supabase, orgId, [thread.id]);
    const session = extras.sessions.get(thread.id);
    const base = threadBot(thread, session) as ThreadBot;
    botDetail = {
      ...base,
      pausedAt: thread.bot_paused_at ?? null,
      statusLine: botStatusLine({ mode: base.mode, reason: base.reason, flow: session?.flow ?? null, step: session?.step ?? null }),
    };
    serving = extras.interests.map(servingView);
  }
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
    bot: botDetail,
    serving,
  };
}
