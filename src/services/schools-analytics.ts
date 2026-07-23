// ────────────────────────────────────────────────────────────
// Schools analytics — data access
// ────────────────────────────────────────────────────────────
// Narrow, scoped reads backing the dashboard's schools widgets. Aggregation
// lives in the route handler; this file only fetches.
//
// These select two columns and page to completion on purpose. PostgREST caps
// a response at ~1000 rows by default, and a silent cap here would read as a
// real number on a dashboard — a wrong headcount is worse than a slow one.
// ────────────────────────────────────────────────────────────

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const PAGE_SIZE = 1000;

async function fetchAllPages<T>(
  build: (from: number, to: number) => any // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) return { data: rows, error };
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { data: rows, error: null };
  }
}

export type ApplicationRow = { program_id: string; status: string };
export type EnrollmentRow = { program_id: string; status: string };

// Live applications for the given programs. Soft-removed applications
// (migration 116) are excluded — they were withdrawn from the pipeline and
// counting them would inflate every denominator.
export async function getApplicationStatusRows(
  supabase: Client,
  programIds: string[]
) {
  if (programIds.length === 0) return { data: [] as ApplicationRow[], error: null };
  return fetchAllPages<ApplicationRow>((from, to) =>
    supabase
      .from("application_responses")
      .select("program_id, status")
      .in("program_id", programIds)
      .is("removed_at", null)
      .range(from, to)
  );
}

// Live enrolments for the given programs. Soft-removed enrolments
// (migration 121) are excluded for the same reason.
export async function getEnrollmentStatusRows(
  supabase: Client,
  programIds: string[]
) {
  if (programIds.length === 0) return { data: [] as EnrollmentRow[], error: null };
  return fetchAllPages<EnrollmentRow>((from, to) =>
    supabase
      .from("enrollments")
      .select("program_id, status")
      .in("program_id", programIds)
      .is("removed_at", null)
      .range(from, to)
  );
}

// Active programs the caller is scoped to. Pass null for programIds to mean
// "every active program" (global-level viewers).
export async function getScopedPrograms(
  supabase: Client,
  programIds: string[] | null
) {
  let query = supabase
    .from("programs")
    .select("id, name, code")
    .eq("status", "active")
    .order("name");
  if (programIds !== null) query = query.in("id", programIds);
  return query;
}
