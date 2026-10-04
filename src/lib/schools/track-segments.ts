// A school is "split into segments" when it has two or more live billing
// courses (FFX: FFX / FFBX / FFWX). Whole-program pricing is a program-level
// concept (migration 101), so a course's legacy `scope` column says nothing
// about this — FFX's three courses are all still scope='full_program'.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type TrackSegment = {
  id: string;
  code: string;
  name: string;
  sequence: number;
  start_date: string | null;
  end_date: string | null;
};

export async function getTrackSegments(
  supabase: Client,
  programId: string,
  statuses: string[] = ["active", "upcoming"]
): Promise<TrackSegment[]> {
  const { data } = await supabase
    .from("billing_courses")
    .select("id, code, name, sequence, start_date, end_date")
    .eq("program_id", programId)
    .in("status", statuses)
    .order("sequence", { ascending: true });
  const rows = (data ?? []) as TrackSegment[];
  return rows.length >= 2 ? rows : [];
}
