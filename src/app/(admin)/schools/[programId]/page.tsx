import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProgramById, getEnrollmentsByProgram, getGradesByProgram, getQuestionsByProgram, getResponsesByProgram, getRemovedResponsesByProgram, getReferenceSlotsByProgram, getReferenceRequestSummaries, getReferenceQuestionsByProgram } from "@/services/schools";
import { fetchAssignableContacts } from "@/lib/auth/assignable-contacts";
import { listProgramLeaders } from "@/services/program-leaders";
import { listProgramEmailTemplates } from "@/services/program-email-templates";
import { ProgramDetail } from "./program-detail";

type UserIdentity = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
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
    .select("id, first_name, last_name, preferred_name, email")
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

export default async function ProgramDetailPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  const supabase = await createClient();
  // Service-role client for reading applicant/user *identities* only (name +
  // email). The RLS-scoped `supabase` client above can't read other users'
  // rows unless the viewer is super_admin/admin, so for a program_leader
  // reviewer every embedded users join comes back null → "Unknown / —".
  // See hydrateUserIdentities below.
  const admin = createAdminClient();

  const { data: program, error: programError } = await getProgramById(supabase, programId);

  if (programError || !program) {
    return (
      <div className="space-y-4">
        <p className="text-destructive">Program not found.</p>
      </div>
    );
  }

  const { data: enrollmentsRaw } = await getEnrollmentsByProgram(supabase, programId);
  const enrollments = await hydrateUserIdentities(admin, enrollmentsRaw ?? [], [
    ["user_id", "users"],
    ["assigned_staff_id", "assigned_staff"],
  ]);
  const { data: grades } = await getGradesByProgram(supabase, programId);

  // Phase-courses (billing_courses) — the unified course concept managed here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: billingCourses } = await (supabase as any)
    .from("billing_courses")
    .select(
      "id, code, name, scope, sequence, status, start_date, end_date, arrival_date, lead_staff_id, description"
    )
    .eq("program_id", programId)
    .order("sequence", { ascending: true });
  const { data: courseStaff } = await admin
    .from("users")
    .select("id, first_name, last_name, preferred_name")
    .order("first_name", { ascending: true })
    .limit(500);

  const { data: questions } = await getQuestionsByProgram(supabase, programId);
  const { data: responsesRaw } = await getResponsesByProgram(supabase, programId);
  const { data: removedResponsesRaw } = await getRemovedResponsesByProgram(supabase, programId);
  const responses = await hydrateUserIdentities(admin, responsesRaw ?? [], [
    ["user_id", "users"],
    ["assigned_staff_id", "assigned_staff"],
  ]);
  const removedResponses = await hydrateUserIdentities(admin, removedResponsesRaw ?? [], [
    ["user_id", "users"],
    ["assigned_staff_id", "assigned_staff"],
  ]);
  const { data: referenceSlots } = await getReferenceSlotsByProgram(supabase, programId);
  const { data: referenceQuestions } = await getReferenceQuestionsByProgram(supabase, programId);

  const applicationIds = (responses ?? []).map((r: any) => r.id);
  const { data: refRequests } = await getReferenceRequestSummaries(supabase, applicationIds);

  // Fetch all users for the enrollment selector (identity fields only, via the
  // service-role client so non-admin reviewers get a populated list too).
  const { data: allUsers } = await admin
    .from("users")
    .select("id, first_name, last_name, preferred_name, email")
    .eq("is_active", true)
    .order("last_name", { ascending: true });

  // Fetch staff pool — anyone with a schools.* permission for this
  // specific program (or any schools.* permission granted globally).
  // Includes the dedicated schools.assignable_as_contact key plus the
  // broader admin/manage permissions, which already imply the user is
  // trusted with this program.
  const staffOptions = await fetchAssignableContacts(admin, programId);

  // Leader team for this school (migration 145). Read via the admin
  // client so the embedded user identities populate for non-admin
  // reviewers, matching how enrollments/responses are hydrated above.
  const { data: leaders } = await listProgramLeaders(admin, programId);

  // Per-program email overrides (migration 146). Empty until a leader
  // customizes an email; the resolver falls back to defaults meanwhile.
  const { data: emailTemplates } = await listProgramEmailTemplates(
    admin,
    programId
  );

  return (
    <div className="space-y-6">
      <ProgramDetail
        program={program}
        enrollments={enrollments ?? []}
        leaders={leaders ?? []}
        emailTemplates={emailTemplates ?? []}
        grades={grades ?? []}
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
      />
    </div>
  );
}
