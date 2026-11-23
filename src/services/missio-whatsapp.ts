// ────────────────────────────────────────────────────────────
// Missio WhatsApp — reads for the pastor inbox (migration 396)
// ────────────────────────────────────────────────────────────
// Pass the pastor's own client: RLS keeps every read to Missio pastors.
// Writes from the webhook and the send route go through
// src/lib/missio/whatsapp/supabase-store.ts (service role) instead.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const THREADS = "missio_whatsapp_threads";
const MESSAGES = "missio_whatsapp_messages";

const THREAD_COLUMNS =
  "id, org_id, contact_id, phone_e164, wa_id, profile_name, last_inbound_at, last_outbound_at, last_message_at, last_message_id, last_preview, last_direction, unread_count, last_read_at, opted_out_at, opt_changed_at, created_at, updated_at";

const MESSAGE_COLUMNS =
  "id, thread_id, direction, kind, body, template_name, status, error_code, error_title, opt_change, sent_at, status_at";

// ────────────────────────────────────────────────────────────
// Threads
// ────────────────────────────────────────────────────────────

export async function listWhatsAppThreads(supabase: Client, orgId: string, options?: { limit?: number }) {
  return supabase
    .from(THREADS)
    .select(THREAD_COLUMNS)
    .eq("org_id", orgId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(options?.limit ?? 200);
}

export async function getWhatsAppThreadById(supabase: Client, orgId: string, threadId: string) {
  return supabase.from(THREADS).select(THREAD_COLUMNS).eq("org_id", orgId).eq("id", threadId).maybeSingle();
}

export async function getWhatsAppThreadByPhone(supabase: Client, orgId: string, e164: string) {
  return supabase.from(THREADS).select(THREAD_COLUMNS).eq("org_id", orgId).eq("phone_e164", e164).maybeSingle();
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

// ────────────────────────────────────────────────────────────
// Messages
// ────────────────────────────────────────────────────────────

/** The newest `limit` messages, newest first. */
export async function listWhatsAppMessages(supabase: Client, orgId: string, threadId: string, options?: { limit?: number }) {
  return supabase
    .from(MESSAGES)
    .select(MESSAGE_COLUMNS)
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
