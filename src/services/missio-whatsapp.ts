// ────────────────────────────────────────────────────────────
// Missio WhatsApp — reads for the pastor inbox (migration 396)
// ────────────────────────────────────────────────────────────
// Pass the pastor's own client: RLS keeps every read to Missio pastors.
// Writes from the webhook and the send route go through
// src/lib/missio/whatsapp/supabase-store.ts (service role) instead.
//
// Migration 397 (the menu bot) adds columns. Reads that want them take
// { bot: true }; callers retry without when 397 isn't applied yet
// (isMissingColumn), so the inbox keeps working either way.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const THREADS = "missio_whatsapp_threads";
const MESSAGES = "missio_whatsapp_messages";

const THREAD_COLUMNS =
  "id, org_id, contact_id, phone_e164, wa_id, profile_name, last_inbound_at, last_outbound_at, last_message_at, last_message_id, last_preview, last_direction, unread_count, last_read_at, opted_out_at, opt_changed_at, created_at, updated_at";

const MESSAGE_COLUMNS =
  "id, thread_id, direction, kind, body, template_name, status, error_code, error_title, opt_change, sent_at, status_at";

const THREAD_BOT_COLUMNS = ", bot_mode, bot_paused_at, bot_handoff_reason";
const MESSAGE_BOT_COLUMNS = ", sent_by_bot";

type BotOption = { bot?: boolean };

// ────────────────────────────────────────────────────────────
// Threads
// ────────────────────────────────────────────────────────────

export async function listWhatsAppThreads(supabase: Client, orgId: string, options?: { limit?: number } & BotOption) {
  return supabase
    .from(THREADS)
    .select(THREAD_COLUMNS + (options?.bot ? THREAD_BOT_COLUMNS : ""))
    .eq("org_id", orgId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(options?.limit ?? 200);
}

export async function getWhatsAppThreadById(supabase: Client, orgId: string, threadId: string, options?: BotOption) {
  return supabase.from(THREADS).select(THREAD_COLUMNS + (options?.bot ? THREAD_BOT_COLUMNS : "")).eq("org_id", orgId).eq("id", threadId).maybeSingle();
}

export async function getWhatsAppThreadByPhone(supabase: Client, orgId: string, e164: string, options?: BotOption) {
  return supabase.from(THREADS).select(THREAD_COLUMNS + (options?.bot ? THREAD_BOT_COLUMNS : "")).eq("org_id", orgId).eq("phone_e164", e164).maybeSingle();
}

/** Pastors may only reset the unread count (column grant in 396). */
export async function markWhatsAppThreadRead(supabase: Client, orgId: string, threadId: string) {
  return supabase
    .from(THREADS)
    .update({ unread_count: 0, last_read_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", threadId)
    .select("id")
    .maybeSingle();
}

/**
 * Pastors take over, pause or resume the menu bot (column grant in 397).
 * bot_paused_at / bot_paused_by are stamped by the 397 trigger as the
 * signed-in pastor, never taken from the request.
 */
export async function setWhatsAppBotMode(
  supabase: Client,
  orgId: string,
  threadId: string,
  patch: { bot_mode: "on" | "paused"; bot_handoff_reason: "pastor" | null }
) {
  return supabase
    .from(THREADS)
    .update(patch)
    .eq("org_id", orgId)
    .eq("id", threadId)
    .select("id, bot_mode, bot_paused_at, bot_handoff_reason")
    .maybeSingle();
}

// ────────────────────────────────────────────────────────────
// Menu bot sessions and serving interests (397)
// ────────────────────────────────────────────────────────────

/** Open bot sessions for these threads (at most one each). */
export async function listOpenBotSessions(supabase: Client, orgId: string, threadIds: string[]) {
  return supabase
    .from("missio_whatsapp_bot_sessions")
    .select("thread_id, flow, step, updated_at")
    .eq("org_id", orgId)
    .in("thread_id", threadIds)
    .is("closed_at", null);
}

export async function listServingInterestsForThreads(supabase: Client, orgId: string, threadIds: string[], options?: { status?: string }) {
  let query = supabase
    .from("missio_serving_interests")
    .select("id, thread_id, teams, availability, experience, note, status, created_at")
    .eq("org_id", orgId)
    .in("thread_id", threadIds)
    .order("created_at", { ascending: false })
    .limit(50);
  if (options?.status) query = query.eq("status", options.status);
  return query;
}

// ────────────────────────────────────────────────────────────
// Messages
// ────────────────────────────────────────────────────────────

/** The newest `limit` messages, newest first. */
export async function listWhatsAppMessages(supabase: Client, orgId: string, threadId: string, options?: { limit?: number } & BotOption) {
  return supabase
    .from(MESSAGES)
    .select(MESSAGE_COLUMNS + (options?.bot ? MESSAGE_BOT_COLUMNS : ""))
    .eq("org_id", orgId)
    .eq("thread_id", threadId)
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 300);
}

export async function getWhatsAppMessageStatuses(supabase: Client, orgId: string, ids: string[]) {
  return supabase.from(MESSAGES).select("id, status").eq("org_id", orgId).in("id", ids);
}

// ────────────────────────────────────────────────────────────
// People (names only, through the Missio directory view)
// ────────────────────────────────────────────────────────────

export async function listMissioNamesByContact(supabase: Client, orgId: string, contactIds: string[]) {
  return supabase
    .from("org_people_directory")
    .select("id, contact_id, first_name, last_name, preferred_name")
    .eq("org_id", orgId)
    .in("contact_id", contactIds);
}
