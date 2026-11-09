import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProgramById, getEnrollmentsByProgram, getGradesByProgram, getQuestionsByProgram, getResponsesByProgram, getRemovedResponsesByProgram, getReferenceSlotsByProgram, getReferenceRequestSummaries, getInterviewReviewSummaries, getReferenceQuestionsByProgram } from "@/services/schools";
import { fetchAssignableContacts } from "@/lib/auth/assignable-contacts";
import { listProgramLeaders } from "@/services/program-leaders";
import { StaffApplicants, type StaffApplicant } from "./staff-applicants";
import type { InterviewOutcome } from "@/lib/schools/interview-outcomes";
import {
  applicationsForViewer,
  canOpenSchools,
  resolveProgramViewer,
} from "@/lib/schools/program-staff-access";
import { listProgramStaff } from "@/services/program-staff";
import { listProgramEmailTemplates } from "@/services/program-email-templates";
import { getArrivalInsuranceInfo } from "@/lib/schools/arrival-insurance";
import { ProgramDetail } from "./program-detail";
import { loadTrackPipeline, summariseTrack } from "@/lib/schools/track-pipeline";
import { Masthead } from "@/components/ffsa";
import { SchoolFeesPanel } from "@/components/finance/school-fees-panel";
import { adminNotesByResponse } from "@/lib/schools/admin-notes";
import { getSchoolBalances } from "@/services/school-balances";
import type { RosterFee } from "./roster-tab";
import { canUseStaffDecisions } from "@/lib/auth/check-okr-access";
import { getLeadershipTrackProgram, loadStaffDecisionRows } from "@/lib/schools/staff-decisions";
import { listActiveMinistries } from "@/services/ministries";
import { StaffDecisionTab } from "./staff-decision-tab";
import { getApplicationExpiry } from "@/lib/auth/application-expiry";

type UserIdentity = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
  /** The roster's FROM column (frame 14a) reads this off the hydrated row. */
  nationality: string | null;
};

/**
 * Populate the embedded `users` / `assigned_staff` identity objects on a set of
 * rows using the service-role client. The RLS-scoped client can't read other
 * users' rows unless the viewer is super_admin/admin, so the embedded joins in
 * the original query are null for a program_leader reviewer. We look up only the
 * five identity columns (never the sensitive PII on `users`) and merge them back
 * onto each row under the field name the UI already reads.
 *
 * `links` maps a foreign-key field on the row (e.g. "user_id") to the embed
 * field the UI expects (e.g. "users").
 */
async function hydrateUserIdentities(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the `Client = any` convention in services
  admin: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows come from `any`-typed service queries
  rows: any[],
  links: Array<[fkField: string, embedField: string]>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- returned rows feed strictly-typed props; keep loose like the services
): Promise<any[]> {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const [fk] of links) {
      const id = row[fk];
      if (typeof id === "string") ids.add(id);
    }
  }
  if (ids.size === 0) return rows;

  const { data: users } = await admin
    .from("users")
    .select("id, first_name, last_name, preferred_name, email, nationality")
    .in("id", Array.from(ids));

  const byId = new Map<string, UserIdentity>(
    (users ?? []).map((u: UserIdentity) => [u.id, u])
  );

  return rows.map((row) => {
    const next: Record<string, unknown> = { ...row };
    for (const [fk, embed] of links) {
      const id = row[fk];
      next[embed] = typeof id === "string" ? byId.get(id) ?? null : null;
    }
    return next;
  });
}

/**
 * An enrolment whose person was deleted has `user_id` NULL and no `users` row
 * to join — migration 207 keeps the enrolment instead of cascading it away.
 * Rebuild the identity from the snapshot delete-user wrote onto the row so the
 * roster and the Arrival tab still show a named person rather than "Unknown",
 * and so the record stays recognisable enough to re-link by hand.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows come from `any`-typed service queries
function withDeletedPersonIdentity(rows: any[]): any[] {
  return rows.map((row) => {
    if (row.user_id || row.users) return row;
    const info = (row.person_info ?? {}) as Record<string, string | null>;
    return {
      ...row,
      users: {
        id: null,
        first_name: info.first_name ?? null,
        last_name: info.last_name ?? null,
        preferred_name: info.preferred_name ?? null,
        email: row.person_email ?? null,
        nationality: info.nationality ?? null,
      },
    };
  });
}

function staffApplicantFromResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any,
  review: { notes: string | null; interview_outcome: string } | undefined
): StaffApplicant {
  const user = Array.isArray(row.users) ? row.users[0] : row.users;
  const info = (row.applicant_info ?? {}) as Record<string, string | null>;
  const name =
    [user?.preferred_name || user?.first_name || info.first_name, user?.last_name || info.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() || row.applicant_email || "Applicant";
  const answers = Array.isArray(row.answers)
    ? row.answers.map((answer: { question_label?: string; answer?: string }) => ({
        label: answer.question_label || "Answer",
        answer: answer.answer || "",
      }))
    : [];
  const outcome = review?.interview_outcome;
  const interviewOutcome: InterviewOutcome =
    outcome === "recommend" || outcome === "hold" || outcome === "decline" || outcome === "pending"
      ? outcome
      : "pending";
  return {
    id: row.id,
    name,
    email: user?.email ?? row.applicant_email ?? info.email ?? null,
    status: row.status,
    submittedAt: row.submitted_at ?? null,
    answers,
    notes: review?.notes ?? "",
    interviewOutcome,
  };
}

export default async function ProgramDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { programId } = await params;
  const { tab } = await searchParams;
  const supabase = await createClient();
  // Service-role client for reading applicant/user *identities* only (name +
  // email). The RLS-scoped `supabase` client above can't read other users'
  // rows unless the viewer is super_admin/admin, so for a program_leader
  // reviewer every embedded users join comes back null → "Unknown / —".
  // See hydrateUserIdentities below.
  const admin = createAdminClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) redirect("/login");

  // Leadership Track "accepted as staff?" tab — Leadership Team only, read
  // with the service-role client so it keeps working after the school ends
  // or is archived. A Leadership Team member without Training access gets a
  // page holding just this tab instead of the usual redirect.
  const viewerIsLeadership = await canUseStaffDecisions(supabase, session.user.id);
  const ltProgram = viewerIsLeadership ? await getLeadershipTrackProgram(admin, programId) : null;
  let staffDecisionPanel: React.ReactNode = null;
  if (ltProgram) {
    const [rows, { data: ministries }] = await Promise.all([
      loadStaffDecisionRows(admin, programId),
      listActiveMinistries(supabase),
    ]);
    staffDecisionPanel = (
      <StaffDecisionTab
        rows={rows}
        departmentOptions={((ministries ?? []) as Array<{ slug: string; name: string }>).map(
          (m) => ({ value: m.slug, label: m.name })
        )}
      />
    );
  }

  const schoolsAccess = await canOpenSchools(supabase, session.user.id);
  if (!schoolsAccess.open) {
    if (!ltProgram) redirect("/dashboard");
    return (
      <div className="ffsa-screen">
        <Masthead context="Leadership Track · Staff decision" title={ltProgram.name} />
        <div className="px-5 py-6 md:px-8">{staffDecisionPanel}</div>
      </div>
    );
  }

  // 6-month expiry lock (migration 223). RLS already hides an expired
  // school's applications from this user client; this only explains why.
  const applicationExpiry = await getApplicationExpiry(supabase, programId);

  const { data: program, error: programError } = await getProgramById(supabase, programId);

  if (programError || !program) {
    return (
      <div className="ffsa-screen">
        <Masthead context="Training" title="Not found" />
        <p className="px-5 py-6 md:px-8 md:py-7 text-[13px] text-destructive">Program not found.</p>
      </div>
    );
  }

  const viewer = await resolveProgramViewer(supabase, session.user.id, programId);

  // Opened Training because they staff a different school. Do not load this
  // school's fees, emails, or applicants.
  if (!schoolsAccess.hasModuleAccess && !viewer.isStaff && !viewer.canManage && !viewer.hasSchoolsGrant) {
    return (
      <div className="ffsa-screen">
        <Masthead context="Training" title={program.name} />
        <p className="px-5 py-6 md:px-8 md:py-7 text-[13px]">This school isn&apos;t open to you.</p>
      </div>
    );
  }

  // Staff without a manage or schools.* grant: assigned applicants only.
  // Finance access adds the fees panel and nothing else.
  if (viewer.staffScoped) {
    const { data: responsesRaw } = await getResponsesByProgram(supabase, programId);
    const visible = applicationsForViewer(responsesRaw ?? [], viewer);
    const hydrated = await hydrateUserIdentities(admin, visible, [["user_id", "users"]]);
    const ids = hydrated.map((row: { id: string }) => row.id);
    let reviewRows: Array<{
      application_response_id: string;
      notes: string | null;
      interview_outcome: string;
    }> = [];
    if (ids.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("application_staff_reviews")
        .select("application_response_id, notes, interview_outcome")
        .in("application_response_id", ids)
        .eq("author_id", session.user.id);
      reviewRows = data ?? [];
    }
    const byResponse = new Map(reviewRows.map((row) => [row.application_response_id, row]));
    return (
      <>
        <StaffApplicants
          programName={program.name}
          applicants={hydrated.map((row: { id: string }) =>
            staffApplicantFromResponse(row, byResponse.get(row.id))
          )}
        />
        {viewer.showFees ? (
          <div className="px-5 py-6 md:px-8">
            <SchoolFeesPanel programId={programId} />
          </div>
        ) : null}
      </>
    );
  }

  const { data: enrollmentsRaw } = await getEnrollmentsByProgram(supabase, programId);
  const enrollments = withDeletedPersonIdentity(
    await hydrateUserIdentities(admin, enrollmentsRaw ?? [], [
      ["user_id", "users"],
      ["assigned_staff_id", "assigned_staff"],
    ])
  );

  // Arrival-day profile + health-insurance summary for the enrolled students.
  // Read via the service-role client (insurance/profile fields on `users` are
  // RLS-nulled for non-admin program leaders) and reduced to a compact,
  // PII-safe summary before it reaches the client. See the lib helper.
  const arrivalInsurance = await getArrivalInsuranceInfo(
    admin,
    (enrollments ?? []).map((e: any) => e.user_id)
  );

  const { data: grades } = await getGradesByProgram(supabase, programId);

  // ── Roster fees (frame 14a) ──────────────────────────────
  // Only a school billed inside the Hub has a schedule to owe against. While a
  // program is billing_mode = 'external' its students are mid-payment outside
  // the Hub, so the honest column is "billed outside" — NOT a fabricated
  // "paid", and never the amber that means someone owes us money.
  const feesByEnrollment: Record<string, RosterFee> = {};
  if (program.billing_mode === "external") {
    for (const e of enrollments) {
      feesByEnrollment[e.id] = { label: "BILLED OUTSIDE", owed: false };
    }
  } else {
    // Same numbers as Finance's student list (services/school-balances.ts):
    // paid comes back from Xero, so this is real progress, not just "invoiced".
    const balances = await getSchoolBalances(admin, programId);
    for (const e of enrollments) {
      const mine = balances.byEnrollment.get(e.id);
      if (!mine || mine.balance.total <= 0) {
        feesByEnrollment[e.id] = { label: "NO PLAN", owed: false };
        continue;
      }
      const b = mine.balance;
      const amounts = { paid: b.paid, total: b.total };
      feesByEnrollment[e.id] =
        b.outstanding <= 0
          ? { label: "PAID", owed: false, progress: { percentPaid: 100, overdue: 0 }, amounts }
          : b.overdue > 0
            ? {
                label: `R ${Math.round(b.overdue).toLocaleString("en-ZA")} OVERDUE`,
                owed: true,
                progress: { percentPaid: b.percentPaid, overdue: b.overdue },
                amounts,
              }
            : {
                label: `${b.percentPaid}% PAID`,
                owed: false,
                progress: { percentPaid: b.percentPaid, overdue: 0 },
                amounts,
              };
    }
  }

  // ── "Last edit" line under the grades matrix (frame 14b) ──
  let gradesLastEdit: { at: string; by: string } | null = null;
  const graded = (grades ?? []).filter((g: any) => g.graded_at);
  if (graded.length > 0) {
    const newest = graded.reduce((a: any, b: any) =>
      new Date(a.graded_at) > new Date(b.graded_at) ? a : b
    );
    let by = "SOMEONE";
    if (newest.graded_by) {
      const { data: grader } = await admin
        .from("users")
        .select("first_name, last_name")
        .eq("id", newest.graded_by)
        .maybeSingle();
      if (grader) {
        by = `${grader.first_name ?? ""} ${(grader.last_name ?? "").slice(0, 1)}`.trim().toUpperCase() || "SOMEONE";
      }
    }
    gradesLastEdit = {
      at: new Date(newest.graded_at)
        .toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
        .toUpperCase(),
      by,
    };
  }

  // Phase-courses (billing_courses) — the unified course concept managed here.
  // credit_hours arrives with migration 179: it heads each grades-matrix column
  // ("3 CR") and weights the transcript GPA. Migrations here are applied by hand
  // through the Supabase dashboard, so a deploy can legitimately land first —
  // fall back to the pre-179 column list rather than blanking the whole tab.
  const BASE_COURSE_COLS =
    "id, code, name, scope, sequence, status, start_date, end_date, arrival_date, lead_staff_id, description";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const courseQuery = (cols: string) => (supabase as any)
    .from("billing_courses")
    .select(cols)
    .eq("program_id", programId)
    .order("sequence", { ascending: true });

  // `graded` arrives with migration 259 — same fall-back-and-carry-on rule.
  let billingCourses = null;
  for (const cols of [
    `${BASE_COURSE_COLS}, credit_hours, graded`,
    `${BASE_COURSE_COLS}, credit_hours`,
    BASE_COURSE_COLS,
  ]) {
    const res = await courseQuery(cols);
    if (!res.error) {
      billingCourses = res.data;
      break;
    }
  }

  // Arrival per course (migration 259). Read on its own rather than embedded in
  // the enrolment query, so a deploy that lands before the migration loses only
  // these marks — never the whole roster.
  const courseArrivals: Record<string, Array<{ billing_course_id: string; status: "arrived" | "no_show" }>> = {};
  const enrollmentIds = enrollments.map((e: any) => e.id);
  for (let i = 0; i < enrollmentIds.length; i += 200) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table is newer than the generated types
    const { data: marks, error: marksError } = await (admin as any)
      .from("enrollment_course_arrivals")
      .select("enrollment_id, billing_course_id, status")
      .in("enrollment_id", enrollmentIds.slice(i, i + 200));
    if (marksError) break;
    for (const m of marks ?? []) {
      (courseArrivals[m.enrollment_id] ??= []).push({ billing_course_id: m.billing_course_id, status: m.status });
    }
  }
  const { data: courseStaff } = await admin
    .from("users")
    .select("id, first_name, last_name, preferred_name")
    .order("first_name", { ascending: true })
    .limit(500);

  const { data: questions } = await getQuestionsByProgram(supabase, programId);
  const { data: responsesRaw } = await getResponsesByProgram(supabase, programId);
  const { data: removedResponsesRaw } = await getRemovedResponsesByProgram(supabase, programId);
  const responsesHydrated = await hydrateUserIdentities(admin, responsesRaw ?? [], [
    ["user_id", "users"],
    ["assigned_staff_id", "assigned_staff"],
  ]);
  const removedHydrated = await hydrateUserIdentities(admin, removedResponsesRaw ?? [], [
    ["user_id", "users"],
    ["assigned_staff_id", "assigned_staff"],
  ]);
  const noteIds = [...responsesHydrated, ...removedHydrated].map((row: { id: string }) => row.id);
  const leaderNotes = await adminNotesByResponse(supabase, noteIds);
  const withNotes = <T extends { id: string }>(rows: T[]) =>
    rows.map((row) => ({ ...row, admin_notes: leaderNotes.get(row.id) ?? null }));
  const responses = withNotes(responsesHydrated);
  const removedResponses = withNotes(removedHydrated);
  const { data: referenceSlots } = await getReferenceSlotsByProgram(supabase, programId);
  const { data: referenceQuestions } = await getReferenceQuestionsByProgram(supabase, programId);

  const applicationIds = (responses ?? []).map((r: any) => r.id);
  const [{ data: refRequests }, interviewReviewResult] = await Promise.all([
    getReferenceRequestSummaries(supabase, applicationIds),
    getInterviewReviewSummaries(supabase, applicationIds),
  ]);
  if (interviewReviewResult.error) {
    console.error("interview reviews for pipeline:", interviewReviewResult.error);
  }

  // Fetch all users for the enrollment selector (identity fields only, via the
  // service-role client so non-admin reviewers get a populated list too).
  const { data: allUsers } = await admin
    .from("users")
    .select("id, first_name, last_name, preferred_name, email")
    .eq("is_active", true)
    .order("last_name", { ascending: true });

  // Staff who can be the point of contact: program-scoped
  // schools.assignable_as_contact, super admins, and active leaders of
  // this program. See fetchAssignableContacts.
  const staffOptions = await fetchAssignableContacts(admin, programId);

  // Leader team for this school (migration 145). Read via the admin
  // client so the embedded user identities populate for non-admin
  // reviewers, matching how enrollments/responses are hydrated above.
  const { data: leaders } = await listProgramLeaders(admin, programId);
  const { data: staff } = await listProgramStaff(admin, programId);

  // Per-program email overrides (migration 146). Empty until a leader
  // customizes an email; the resolver falls back to defaults meanwhile.
  const { data: emailTemplates } = await listProgramEmailTemplates(
    admin,
    programId
  );

  // Track tab data — empty (and the tab hidden) unless the school is split into
  // segments. Read via the service-role client for the same reason as above.
  const trackPipeline = await loadTrackPipeline(admin, programId);
  const trackSummary = summariseTrack(trackPipeline.people, trackPipeline.segments);

  // ProgramDetail carries its own `.ffsa-screen` root + Masthead, so this
  // route adds no wrapper of its own — an extra div here would put the
  // edge-to-edge screen back inside the old centred page box.
  return (
    <>
      <ProgramDetail
        program={program}
        initialTab={tab}
        enrollments={enrollments ?? []}
        trackSegments={trackPipeline.segments.map((c) => ({ code: c.code, name: c.name }))}
        trackPeople={trackPipeline.people}
        trackSummary={trackSummary}
        arrivalInsurance={arrivalInsurance}
        leaders={leaders ?? []}
        staff={staff ?? []}
        emailTemplates={emailTemplates ?? []}
        grades={grades ?? []}
        feesByEnrollment={feesByEnrollment}
        feesBilledOutside={program.billing_mode === "external"}
        courseArrivals={courseArrivals}
        feesPanel={<SchoolFeesPanel programId={programId} />}
        gradesLastEdit={gradesLastEdit}
        allUsers={allUsers ?? []}
        staffOptions={staffOptions}
        billingCourses={billingCourses ?? []}
        courseStaff={courseStaff ?? []}
        questions={questions ?? []}
        responses={responses ?? []}
        removedResponses={removedResponses ?? []}
        referenceSlots={referenceSlots ?? []}
        referenceQuestions={referenceQuestions ?? []}
        refRequestSummaries={refRequests ?? []}
        interviewReviews={interviewReviewResult.data ?? []}
        applicationExpiry={applicationExpiry}
        staffDecisionPanel={staffDecisionPanel ?? undefined}
        canEditClassroom={viewer.canManage}
      />
    </>
  );
}
