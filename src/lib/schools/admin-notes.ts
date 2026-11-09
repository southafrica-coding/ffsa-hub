// Leader notes live in application_admin_notes (migration 304).
// application_responses.admin_notes is deprecated. 304 copies it and
// leaves it in place until the follow-up SQL in docs/program-staff.md.
// A query error is thrown: an empty map would look like
// "no notes" and a later save would wipe the real ones. A person the
// policy rejects gets no rows and no error, which is an empty map.

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
  if (error) throw new Error(error.message);
  if (!data) return notes;
  for (const row of data as Array<{ application_response_id: string; notes: string | null }>) {
    notes.set(row.application_response_id, row.notes);
  }
  return notes;
}
