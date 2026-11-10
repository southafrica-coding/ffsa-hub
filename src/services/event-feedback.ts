// Reads and writes for post-event feedback (migration 180).
//
// Mirrors the shape of src/services/forms.ts, but nothing here touches
// contacts, labels or workflows — feedback is analytics about how the
// event was run, not CRM data about the people who came.

// The generated database types (src/types/database.ts) lag the migration
// history, so these tables are typed here by hand — the same convention
// the other post-140 services follow.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type FeedbackFormStatus = "draft" | "open" | "closed";

export type FeedbackFormInsert = {
  event_id: string;
  slug: string;
  title: string;
  intro?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema?: any;
  is_anonymous?: boolean;
  status?: FeedbackFormStatus;
  closes_at?: string | null;
  thank_you_heading?: string | null;
  thank_you_message?: string | null;
  created_by?: string | null;
};

export type FeedbackFormUpdate = Partial<Omit<FeedbackFormInsert, "event_id">>;

export type FeedbackResponseInsert = {
  form_id: string;
  respondent_name?: string | null;
  respondent_email?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  answers: any;
  user_agent?: string | null;
};

export type FeedbackSendInsert = {
  form_id: string;
  to_email: string;
  to_name?: string | null;
  kind: "invite" | "reminder";
  status?: "sent" | "failed" | "suppressed";
  error?: string | null;
  sent_by?: string | null;
};

// ────────────────────────────────────────────────────────────
// Forms
// ────────────────────────────────────────────────────────────

export async function listFeedbackFormsForEvent(
  supabase: Client,
  eventId: string
) {
  return supabase
    .from("event_feedback_forms")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });
}

export async function getFeedbackFormById(supabase: Client, id: string) {
  return supabase
    .from("event_feedback_forms")
    .select("*, events:event_id(id, title, brand, logo_url, start_date, end_date)")
    .eq("id", id)
    .maybeSingle();
}

export async function getFeedbackFormBySlug(supabase: Client, slug: string) {
  return supabase
    .from("event_feedback_forms")
    .select("*, events:event_id(id, title, brand, logo_url, start_date, end_date)")
    .eq("slug", slug)
    .maybeSingle();
}

export async function createFeedbackForm(supabase: Client, data: FeedbackFormInsert) {
  return supabase.from("event_feedback_forms").insert(data).select().single();
}

export async function updateFeedbackForm(
  supabase: Client,
  id: string,
  data: FeedbackFormUpdate
) {
  return supabase
    .from("event_feedback_forms")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
}

export async function deleteFeedbackForm(supabase: Client, id: string) {
  return supabase.from("event_feedback_forms").delete().eq("id", id).select("id");
}

/** Slug for the public /fb/<slug> link. Event title + form title, deduped. */
export async function generateUniqueFeedbackSlug(
  supabase: Client,
  seed: string
): Promise<string> {
  const base =
    seed
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "feedback";

  let candidate = base;
  let n = 1;
  for (;;) {
    const { data } = await supabase
      .from("event_feedback_forms")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

// ────────────────────────────────────────────────────────────
// Responses
// ────────────────────────────────────────────────────────────

export async function listFeedbackResponses(supabase: Client, formId: string) {
  return supabase
    .from("event_feedback_responses")
    .select("id, respondent_name, respondent_email, answers, submitted_at")
    .eq("form_id", formId)
    .order("submitted_at", { ascending: false });
}

export async function insertFeedbackResponse(
  supabase: Client,
  data: FeedbackResponseInsert
) {
  return supabase.from("event_feedback_responses").insert(data).select().single();
}

export async function deleteFeedbackResponse(supabase: Client, id: string) {
  return supabase.from("event_feedback_responses").delete().eq("id", id);
}

/**
 * Response counts for a set of forms, in one round trip. Postgrest has no
 * group-by, so the ids come back and the tally happens here — fine at the
 * volume a single event's debrief produces.
 */
export async function countResponsesByForm(
  supabase: Client,
  formIds: string[]
): Promise<Record<string, number>> {
  if (!formIds.length) return {};
  const { data } = await supabase
    .from("event_feedback_responses")
    .select("form_id")
    .in("form_id", formIds);
  const out: Record<string, number> = {};
  for (const row of (data ?? []) as { form_id: string }[]) {
    out[row.form_id] = (out[row.form_id] ?? 0) + 1;
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// Sends
// ────────────────────────────────────────────────────────────

export async function listFeedbackSends(supabase: Client, formId: string) {
  return supabase
    .from("event_feedback_sends")
    .select("id, to_email, to_name, kind, status, error, sent_at")
    .eq("form_id", formId)
    .order("sent_at", { ascending: false });
}

export async function recordFeedbackSends(
  supabase: Client,
  rows: FeedbackSendInsert[]
) {
  if (!rows.length) return { data: [], error: null };
  return supabase.from("event_feedback_sends").insert(rows).select();
}
