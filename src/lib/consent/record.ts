// FFSA Hub — Consent events (migration 187).
//
// The append-only record of when, and on what evidence, a person's consent
// changed. `unsubscribes` remains the operational filter the send path reads;
// this is the audit trail beside it, which POPIA asks for and which
// `unsubscribes` cannot be — it is a current-state table with no history and
// no evidence.
//
// Writes are best-effort in the same sense as the email ledger: failing to
// record consent must never stop someone from opting out. Losing the log
// entry is bad; refusing to honour the opt-out is worse.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type ConsentKind =
  | "opted_in"
  | "confirmed"
  | "muted_topic"
  | "unsubscribed"
  | "objected"
  | "deleted_request";

export type ConsentSource =
  | "web_form"
  | "event_signup"
  | "application"
  | "donation"
  | "staff_entry"
  | "import"
  | "email_footer"
  | "preferences_page"
  | "bounce_threshold"
  | "complaint";

export type ConsentEvidence = {
  ip?: string | null;
  userAgent?: string | null;
  formId?: string | null;
  campaignId?: string | null;
  note?: string | null;
};

/**
 * Record one consent change.
 *
 * `labelId` is the topic: null means the whole relationship, a label id means
 * that topic only — the same scoping `unsubscribes` uses, so the log and the
 * filter can never disagree about what "topic" means.
 */
export async function recordConsentEvent(
  admin: Client,
  input: {
    contactId: string;
    kind: ConsentKind;
    source: ConsentSource;
    labelId?: string | null;
    evidence?: ConsentEvidence;
    createdBy?: string | null;
    at?: string;
  }
): Promise<void> {
  try {
    const evidence: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input.evidence ?? {})) {
      if (v !== undefined && v !== null && v !== "") evidence[k] = v;
    }

    await admin.from("consent_events").insert({
      contact_id: input.contactId,
      kind: input.kind,
      source: input.source,
      label_id: input.labelId ?? null,
      evidence,
      created_by: input.createdBy ?? null,
      ...(input.at ? { at: input.at } : {}),
    });
  } catch {
    // See the note at the top: never block the consent change itself.
  }
}

/**
 * What a request can prove about who asked. Headers are attacker-controlled,
 * so this is evidence of what we were told, not proof of origin — worth
 * recording, not worth trusting.
 */
export function evidenceFromRequest(request: Request): ConsentEvidence {
  const h = request.headers;
  const forwarded = h.get("x-forwarded-for");
  return {
    ip: forwarded ? forwarded.split(",")[0].trim() : null,
    userAgent: h.get("user-agent"),
  };
}
