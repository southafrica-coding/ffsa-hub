// FFSA Hub — the set of CRM labels an event applies to its people.
//
// Migration 193. An event feeds several labels, not one. Everyone who
// comes in through the event gets ALL of them: form respondents
// (/api/f/[slug]/submit) and ticket buyers (ticketing/crm-resolution).
//
// events.base_label_id is kept as the PRIMARY label — it is what a new
// event form takes as its default label_id — and is always a member of
// the set. setEventLabels writes both, so they never drift.

import { addLabelToContact } from "@/services/labels";
import { logLabelAdded } from "@/services/activity-events";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

/** Every label id the event applies, primary first. */
export async function getEventLabelIds(
  supabase: Client,
  eventId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("event_labels")
    .select("label_id")
    .eq("event_id", eventId);
  return ((data ?? []) as { label_id: string }[]).map((r) => r.label_id);
}

/**
 * Replace the event's label set. The first id is stored as the primary
 * (events.base_label_id); an empty list clears both the set and the
 * primary.
 */
export async function setEventLabels(
  supabase: Client,
  eventId: string,
  labelIds: string[]
): Promise<{ error: string | null }> {
  const unique = Array.from(new Set(labelIds.filter(Boolean)));

  const { error: delErr } = await supabase
    .from("event_labels")
    .delete()
    .eq("event_id", eventId);
  if (delErr) return { error: delErr.message };

  if (unique.length > 0) {
    const { error: insErr } = await supabase
      .from("event_labels")
      .insert(unique.map((label_id) => ({ event_id: eventId, label_id })));
    if (insErr) return { error: insErr.message };
  }

  const { error: evErr } = await supabase
    .from("events")
    .update({ base_label_id: unique[0] ?? null })
    .eq("id", eventId);
  if (evErr) return { error: evErr.message };

  return { error: null };
}

/**
 * Apply every one of the event's labels to a contact. Idempotent —
 * contact_labels upserts on (contact_id, label_id), and label_added is
 * only logged for rows that were genuinely new.
 */
export async function applyEventLabelsToContact(
  supabase: Client,
  params: {
    eventId: string;
    contactId: string;
    addedVia: string;
    userId: string | null;
    /** Labels already applied by the caller — skipped here. */
    skip?: (string | null)[];
  }
): Promise<void> {
  const skip = new Set((params.skip ?? []).filter(Boolean) as string[]);
  const labelIds = (await getEventLabelIds(supabase, params.eventId)).filter(
    (id) => !skip.has(id)
  );

  for (const labelId of labelIds) {
    const inserted = await addLabelToContact(supabase, {
      contact_id: params.contactId,
      label_id: labelId,
      added_via: params.addedVia,
      added_by: params.userId,
    });
    if (inserted.data) {
      await logLabelAdded(supabase, {
        contactId: params.contactId,
        labelId,
        addedVia: params.addedVia,
        userId: params.userId,
      });
    }
  }
}
