// ────────────────────────────────────────────────────────────
// Schools demographics — data access
// ────────────────────────────────────────────────────────────
// Backs the fee-tier / nationality / gender dashboard widgets.
//
// WHY THESE READS USE THE SERVICE-ROLE CLIENT
// `public.users` grants SELECT to own-row and `is_admin()` only
// (002_rls_policies.sql), and `is_admin()` is super_admin/admin — NOT
// program_leader or a program-scoped training staffer. Read as the caller,
// every joined user row comes back null and the whole breakdown silently
// reads "Unknown" for exactly the people this is built for.
//
// The alternative — widening SELECT on `users` — would expose passport
// numbers, visa data and emergency contacts to everyone with any schools
// grant, to answer a question about counts. So the route enforces scope
// itself via getSchoolsCountScopes and returns ONLY aggregate counts, never
// rows. This is the "cross-user reporting" case CLAUDE.md reserves the
// service-role client for.
//
// The caller MUST pass programIds it has already authorised. Nothing here
// checks permission.
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

export type EnrollmentPerson = { program_id: string; user_id: string; status: string };

export type ApplicantPerson = {
  program_id: string;
  user_id: string | null;
  status: string;
  // Anonymous public applicants have no user row; their nationality and gender
  // live here (see src/app/api/public/applications/route.ts, which copies both
  // off the application onto applicant_info). Gender is collected as a per-program
  // question, so — like nationality — it may be present on the application even
  // when the linked user's profile is blank.
  applicant_info: {
    nationality?: string | null;
    gender?: string | null;
  } | null;
};

export type UserDemographics = {
  id: string;
  gender: string | null;
  nationality: string | null;
};

export async function getEnrollmentPeople(admin: Client, programIds: string[]) {
  if (programIds.length === 0) return { data: [] as EnrollmentPerson[], error: null };
  return fetchAllPages<EnrollmentPerson>((from, to) =>
    admin
      .from("enrollments")
      .select("program_id, user_id, status")
      .in("program_id", programIds)
      .is("removed_at", null)
      .range(from, to)
  );
}

export async function getApplicantPeople(admin: Client, programIds: string[]) {
  if (programIds.length === 0) return { data: [] as ApplicantPerson[], error: null };
  return fetchAllPages<ApplicantPerson>((from, to) =>
    admin
      .from("application_responses")
      .select("program_id, user_id, status, applicant_info")
      .in("program_id", programIds)
      .is("removed_at", null)
      .range(from, to)
  );
}

// Only the three columns the breakdowns need — no wider PII is read, even
// with the service-role client.
export async function getUserDemographics(admin: Client, userIds: string[]) {
  if (userIds.length === 0) return { data: [] as UserDemographics[], error: null };
  const out: UserDemographics[] = [];
  // `.in()` on a huge id list makes an unwieldy URL, so chunk it.
  for (let i = 0; i < userIds.length; i += PAGE_SIZE) {
    const chunk = userIds.slice(i, i + PAGE_SIZE);
    const { data, error } = await admin
      .from("users")
      .select("id, gender, nationality")
      .in("id", chunk);
    if (error) return { data: out, error };
    out.push(...((data ?? []) as UserDemographics[]));
  }
  return { data: out, error: null };
}
