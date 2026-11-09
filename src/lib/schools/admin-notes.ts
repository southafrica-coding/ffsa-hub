// Leader notes live in application_admin_notes (migration 304). The
// column on application_responses is not selectable by signed-in users.
// A miss (table not applied yet, or this person cannot read notes)
// comes back as an empty map — callers then show no notes.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export async function adminNotesByResponse(
  supabase: Client,
  ids: string[]
): Promise<Map<string, string | null>> {
  const notes = new Map<string, string | null>();
  if (ids.length === 0) return notes;
  const { data, error } = await supabase
    .from("application_admin_notes")
    .select("application_response_id, notes")
    .in("application_response_id", ids);
  if (error || !data) return notes;
  for (const row of data as Array<{ application_response_id: string; notes: string | null }>) {
    notes.set(row.application_response_id, row.notes);
  }
  return notes;
}
