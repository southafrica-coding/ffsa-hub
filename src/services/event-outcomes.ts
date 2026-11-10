import type { TablesInsert, TablesUpdate } from "@/types/database";

type OutcomeInsert = TablesInsert<"event_outcomes">;
type OutcomeUpdate = TablesUpdate<"event_outcomes">;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ────────────────────────────────────────────────────────────
// Event outcomes
// ────────────────────────────────────────────────────────────

export async function getEventOutcomes(supabase: Client, eventId: string) {
  return supabase
    .from("event_outcomes")
    .select("*, labels(id, slug, name, color)")
    .eq("event_id", eventId)
    .order("sort_order")
    .order("created_at");
}

export async function getOutcomeById(supabase: Client, id: string) {
  return supabase
    .from("event_outcomes")
    .select("*, labels(id, slug, name, color)")
    .eq("id", id)
    .maybeSingle();
}

export async function createEventOutcome(supabase: Client, data: OutcomeInsert) {
  return supabase.from("event_outcomes").insert(data).select().single();
}

export async function updateEventOutcome(
  supabase: Client,
  id: string,
  data: OutcomeUpdate
) {
  return supabase.from("event_outcomes").update(data).eq("id", id).select().single();
}

export async function deleteEventOutcome(supabase: Client, id: string) {
  return supabase.from("event_outcomes").delete().eq("id", id).select("id");
}

// ────────────────────────────────────────────────────────────
// Outcome responses (read-side — analytics)
// ────────────────────────────────────────────────────────────

export async function getOutcomeResponseCounts(supabase: Client, eventId: string) {
  // One row per outcome with the number of responses.
  return supabase
    .from("event_outcomes")
    .select("id, name, event_outcome_responses(count)")
    .eq("event_id", eventId);
}
