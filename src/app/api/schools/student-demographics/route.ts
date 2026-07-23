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
  rankCountries,
  type Breakdown,
  type Person,
  type Tier,
} from "@/lib/schools/demographics";

// Fee tier / nationality / gender breakdowns for the dashboard, served for
// BOTH scopes in one pass so the widgets can toggle without re-fetching.
//
// Students and applicants are returned SEPARATELY on purpose. An enrolled
// student almost always has an application row too, so unioning them would
// double-count the same person — the two are different questions ("who is on
// our roster" vs "who applied"), not two halves of one number.
//
// On the service-role client, see the note in services/schools-demographics.ts.
// Scope is enforced here; only aggregate counts leave this handler.

const ENROLLED_STATUSES = ["waiting_for_arrival", "arrived", "graduated"];

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
    return NextResponse.json({ programs: [], students: null, applicants: null });
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
  const applicants = applicantResult.data as ApplicantPerson[];

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

  const studentsByProgram = new Map<string, Breakdown>(
    programIds.map((id) => [id, emptyBreakdown()])
  );
  const applicantsByProgram = new Map<string, Breakdown>(
    programIds.map((id) => [id, emptyBreakdown()])
  );

  for (const row of enrolments) {
    const target = studentsByProgram.get(row.program_id);
    if (!target) continue;
    const u = userById.get(row.user_id);
    const person: Person = {
      programId: row.program_id,
      nationality: u?.nationality ?? null,
      gender: u?.gender ?? null,
    };
    addPerson(target, person, tierMap as Record<string, Tier>);
  }

  for (const row of applicants) {
    const target = applicantsByProgram.get(row.program_id);
    if (!target) continue;
    const u = row.user_id ? userById.get(row.user_id) : undefined;
    // Anonymous applicants: nationality comes off applicant_info, and gender
    // simply isn't collected on the public form — it lands in "Not recorded".
    const person: Person = {
      programId: row.program_id,
      nationality: u?.nationality ?? row.applicant_info?.nationality ?? null,
      gender: u?.gender ?? null,
    };
    addPerson(target, person, tierMap as Record<string, Tier>);
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
    students: shape(studentsByProgram),
    applicants: shape(applicantsByProgram),
  });
}
