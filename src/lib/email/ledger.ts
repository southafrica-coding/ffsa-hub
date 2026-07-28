// FFSA Hub — Email delivery ledger (migration 141).
//
// The single place the app records "we sent an email" and "here's what
// happened to it". Every send should route a record through here so
// delivery stops being a fire-and-forget black box:
//
//   recordEmail()            → write a row the moment we're about to send
//   markSent() / markFailed()→ capture the provider's immediate response
//   applyProviderEvent()     → advance the row from a delivery webhook
//
// Writes use the service-role (admin) client and are deliberately
// best-effort: logging must NEVER break an actual send. Every function
// swallows its own errors and returns a soft result, mirroring how the
// send paths themselves already treat email as non-blocking.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type EmailProvider = "resend" | "mailtrap";

export type EmailLedgerStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "opened"
  | "bounced"
  | "complained"
  | "failed"
  | "dropped";

export type RecordEmailInput = {
  toEmail: string;
  provider: EmailProvider;
  category?: string | null;
  subject?: string | null;
  contactId?: string | null;
  eventId?: string | null;
  orderId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
};

/**
 * Insert a 'queued' ledger row before sending. Returns the row id (used
 * to flip it to sent/failed once the provider responds), or null if the
 * insert failed / the table isn't there yet — callers treat null as
 * "logging unavailable" and carry on sending.
 */
export async function recordEmail(
  admin: Client,
  input: RecordEmailInput
): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from("email_messages")
      .insert({
        to_email: input.toEmail,
        provider: input.provider,
        category: input.category ?? null,
        subject: input.subject ?? null,
        contact_id: input.contactId ?? null,
        event_id: input.eventId ?? null,
        order_id: input.orderId ?? null,
        source_type: input.sourceType ?? null,
        source_id: input.sourceId ?? null,
        status: "queued",
      })
      .select("id")
      .single();
    if (error) {
      console.warn("[email-ledger] recordEmail failed (non-blocking):", error.message);
      return null;
    }
    return data.id as string;
  } catch (e) {
    console.warn("[email-ledger] recordEmail threw (non-blocking):", e);
    return null;
  }
}

/** Provider accepted the send. Store its message id and mark 'sent'. */
export async function markSent(
  admin: Client,
  id: string | null,
  providerMessageId: string | null
): Promise<void> {
  if (!id) return;
  try {
    await admin
      .from("email_messages")
      .update({
        status: "sent",
        provider_message_id: providerMessageId,
        sent_at: new Date().toISOString(),
      })
      .eq("id", id);
  } catch (e) {
    console.warn("[email-ledger] markSent threw (non-blocking):", e);
  }
}

/** Our send call errored before the provider saw it. */
export async function markFailed(
  admin: Client,
  id: string | null,
  error: string
): Promise<void> {
  if (!id) return;
  try {
    await admin
      .from("email_messages")
      .update({ status: "failed", error })
      .eq("id", id);
  } catch (e) {
    console.warn("[email-ledger] markFailed threw (non-blocking):", e);
  }
}

// ── Delivery-webhook side ───────────────────────────────────────────

export type NormalizedDeliveryEvent = {
  /** The provider's message id, used to find the row we wrote at send. */
  providerMessageId: string;
  status: Extract<
    EmailLedgerStatus,
    "delivered" | "opened" | "bounced" | "complained" | "dropped"
  >;
  /** Bounce/complaint reason, if the provider gave one. */
  reason?: string | null;
  bounceType?: "hard" | "soft" | null;
  /** Raw provider payload, stored for debugging. */
  raw?: unknown;
};

// A later delivery signal shouldn't clobber an earlier, stronger one on
// the same row (a stray 'delivered' arriving after a 'bounced', say). We
// only advance to a state at least as far along as the current one.
const RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
  // terminal negative states outrank the positive ladder
  dropped: 4,
  bounced: 5,
  complained: 6,
  failed: 5,
};

const TIMESTAMP_COLUMN: Record<string, string | null> = {
  delivered: "delivered_at",
  opened: "opened_at",
  bounced: "bounced_at",
  complained: "complained_at",
  dropped: null,
};

/**
 * Apply a normalized delivery event from a provider webhook to the
 * matching ledger row. Idempotent and monotonic — replays and
 * out-of-order events won't downgrade a row. Returns whether a row was
 * updated (false = we have no record of that message id, which is fine).
 */
export async function applyProviderEvent(
  admin: Client,
  provider: EmailProvider,
  ev: NormalizedDeliveryEvent
): Promise<boolean> {
  try {
    const { data: row, error } = await admin
      .from("email_messages")
      .select("id, status")
      .eq("provider", provider)
      .eq("provider_message_id", ev.providerMessageId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !row) return false;

    if ((RANK[ev.status] ?? 0) < (RANK[row.status] ?? 0)) {
      // Incoming signal is weaker than what we already know — record the
      // raw payload for the trail but don't move the status backwards.
      await admin
        .from("email_messages")
        .update({ raw_event: ev.raw ?? null })
        .eq("id", row.id);
      return true;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: Record<string, any> = {
      status: ev.status,
      raw_event: ev.raw ?? null,
    };
    const tsCol = TIMESTAMP_COLUMN[ev.status];
    if (tsCol) patch[tsCol] = new Date().toISOString();
    if (ev.reason) patch.error = ev.reason;
    if (ev.bounceType) patch.bounce_type = ev.bounceType;

    await admin.from("email_messages").update(patch).eq("id", row.id);
    return true;
  } catch (e) {
    console.warn("[email-ledger] applyProviderEvent threw (non-blocking):", e);
    return false;
  }
}
