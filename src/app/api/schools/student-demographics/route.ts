import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSchoolsCountScopes } from "@/lib/auth/schools-count-scopes";
import { getCountryTierMap } from "@/services/school-billing";
import { getScopedPrograms } from "@/services/schools-analytics";
import {
  getEnrollmentPeople,
  getApplicantPeople,
  getUserDemographics,
  type ApplicantPerson,
  type EnrollmentPerson,
} from "@/services/schools-demographics";
import {
  addPerson,
  combineBreakdowns,
  emptyBreakdown,
  normaliseGender,
  rankCountries,
  type Breakdown,
  type Person,
  type Tier,
} from "@/lib/schools/demographics";

// Fee tier / nationality / gender breakdowns for the dashboard.
//
// The population is ONE deduped set: every person with an accepted application
// OR an enrollment that is awaiting arrival or arrived, counted once. Such a
// student almost always has an accepted application row too, so we dedup per
// (program, user) to avoid counting the same person twice. This deliberately
// excludes rejected / waitlisted / cancelled applicants and dismissed /
// decided_to_leave / graduated enrollments — the question is "who is accepted
// or coming/here", not "who is on the roster" or "who ever applied".
//
// On the service-role client, see the note in services/schools-demographics.ts.
// Scope is enforced here; only aggregate counts leave this handler.

const ENROLLED_STATUSES = ["waiting_for_arrival", "arrived"];
const ACCEPTED_STATUS = "accepted";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { globalLevel, programLevels } = await getSchoolsCountScopes(
    supabase,
    user.id
  );
  const scopedIds = Object.keys(programLevels);
  if (globalLevel === null && scopedIds.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Programs are resolved as the CALLER, so RLS still decides which programs
  // exist for them. The service-role client is used only for the demographic
  // rows hanging off these already-authorised program ids.
  const { data: programs, error: programsError } = await getScopedPrograms(
    supabase,
    globalLevel !== null ? null : scopedIds
  );
  if (programsError) {
    return NextResponse.json({ error: programsError.message }, { status: 500 });
  }

  const programRows = (programs ?? []) as Array<{
    id: string;
    name: string;
    code: string;
  }>;
  const programIds = programRows.map((p) => p.id);

  if (programIds.length === 0) {
    return NextResponse.json({ programs: [], population: null });
  }

  const admin = createAdminClient();

  const [enrolResult, applicantResult, tierMap] = await Promise.all([
    getEnrollmentPeople(admin, programIds),
    getApplicantPeople(admin, programIds),
    getCountryTierMap(supabase),
  ]);
  if (enrolResult.error) {
    return NextResponse.json({ error: enrolResult.error.message }, { status: 500 });
  }
  if (applicantResult.error) {
    return NextResponse.json(
      { error: applicantResult.error.message },
      { status: 500 }
    );
  }

  const enrolments = (enrolResult.data as EnrollmentPerson[]).filter((e) =>
    ENROLLED_STATUSES.includes(e.status)
  );
  const applicants = (applicantResult.data as ApplicantPerson[]).filter(
    (a) => a.status === ACCEPTED_STATUS
  );

  // One users lookup covering both scopes.
  const userIds = Array.from(
    new Set(
      [
        ...enrolments.map((e) => e.user_id),
        ...applicants.map((a) => a.user_id),
      ].filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );
  const usersResult = await getUserDemographics(admin, userIds);
  if (usersResult.error) {
    return NextResponse.json({ error: usersResult.error.message }, { status: 500 });
  }
  const userById = new Map(usersResult.data.map((u) => [u.id, u]));

  // Citizenship captured on the application form (applicant_info.nationality) is
  // far more complete than the sparse users.nationality profile field, so we
  // prefer it — including for enrolled students, whose enrollment row carries no
  // nationality of its own. Keyed by user because nationality is a personal
  // attribute: any of a person's applications (any status) carries the same
  // citizenship, so we scan the full application set, not just accepted ones.
  const appNationalityByUser = new Map<string, string>();
  for (const a of applicantResult.data as ApplicantPerson[]) {
    const nat = a.applicant_info?.nationality?.trim();
    if (a.user_id && nat && !appNationalityByUser.has(a.user_id)) {
      appNationalityByUser.set(a.user_id, nat);
    }
  }
  // Application first, then the users profile as a fallback. Null for people
  // with no user id (handled inline where an application row is in hand).
  const nationalityFor = (userId: string | null): string | null => {
    if (!userId) return null;
    return appNationalityByUser.get(userId) ?? userById.get(userId)?.nationality ?? null;
  };

  // Gender is collected as a per-program application question and copied onto
  // applicant_info.gender (see the apply routes + migration 148). Like
  // nationality, it's far more complete there than the sparse users.gender
  // profile field — and enrolled students carry no gender on the enrollment
  // row — so we prefer the application value, keyed per user.
  const appGenderByUser = new Map<string, string>();
  for (const a of applicantResult.data as ApplicantPerson[]) {
    const g = normaliseGender(a.applicant_info?.gender);
    if (a.user_id && g && !appGenderByUser.has(a.user_id)) {
      appGenderByUser.set(a.user_id, g);
    }
  }
  const genderFor = (userId: string | null): string | null => {
    if (!userId) return null;
    return (
      appGenderByUser.get(userId) ??
      normaliseGender(userById.get(userId)?.gender) ??
      null
    );
  };

  const byProgram = new Map<string, Breakdown>(
    programIds.map((id) => [id, emptyBreakdown()])
  );
  // Tracks which users are already counted in a program, so an accepted
  // applicant who is also enrolled isn't counted twice. Keyed per program:
  // the same person may legitimately appear in two different schools.
  const countedByProgram = new Map<string, Set<string>>(
    programIds.map((id) => [id, new Set<string>()])
  );

  // Enrolled (awaiting-arrival or arrived) students first — they anchor the
  // dedup set.
  for (const row of enrolments) {
    const target = byProgram.get(row.program_id);
    if (!target) continue;
    const person: Person = {
      programId: row.program_id,
      nationality: nationalityFor(row.user_id),
      gender: genderFor(row.user_id),
    };
    addPerson(target, person, tierMap as Record<string, Tier>);
    // An enrolment orphaned by a deleted account (migration 207) has no user to
    // dedupe on — it still counts as a person, it just can't anchor the set.
    if (row.user_id) countedByProgram.get(row.program_id)?.add(row.user_id);
  }

  // Accepted applicants, skipping anyone already counted as enrolled in the
  // same program. Anonymous applicants (no user row) can't be deduped and each
  // represents a distinct person, so they're always counted.
  for (const row of applicants) {
    const target = byProgram.get(row.program_id);
    if (!target) continue;
    if (row.user_id && countedByProgram.get(row.program_id)?.has(row.user_id)) {
      continue;
    }
    // Nationality and gender from this application first (incl. anonymous
    // applicants, who have no user row), then any other application / users
    // profile.
    const person: Person = {
      programId: row.program_id,
      nationality:
        row.applicant_info?.nationality?.trim() || nationalityFor(row.user_id),
      gender: normaliseGender(row.applicant_info?.gender) ?? genderFor(row.user_id),
    };
    addPerson(target, person, tierMap as Record<string, Tier>);
    if (row.user_id) countedByProgram.get(row.program_id)?.add(row.user_id);
  }

  const shape = (byProgram: Map<string, Breakdown>) => {
    const perProgram = programRows.map((p) => {
      const b = byProgram.get(p.id) ?? emptyBreakdown();
      return {
        id: p.id,
        name: p.name,
        code: p.code,
        total: b.total,
        tiers: b.tiers,
        genders: b.genders,
        // Full ranking per school; the widget decides how many to show.
        nationalities: rankCountries(b.nationalities, b.total),
      };
    });
    const overall = combineBreakdowns(Array.from(byProgram.values()));
    return {
      perProgram,
      overall: {
        total: overall.total,
        tiers: overall.tiers,
        genders: overall.genders,
        nationalities: rankCountries(overall.nationalities, overall.total),
      },
    };
  };

  return NextResponse.json({
    programs: programRows.map((p) => ({ id: p.id, name: p.name, code: p.code })),
    population: shape(byProgram),
  });
}
