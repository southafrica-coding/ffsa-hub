import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProgramById, getEnrollmentsByProgram, getGradesByProgram, getQuestionsByProgram, getResponsesByProgram, getReferenceSlotsByProgram, getReferenceRequestSummaries, getReferenceQuestionsByProgram } from "@/services/schools";
import { fetchAssignableContacts } from "@/lib/auth/assignable-contacts";
import { ProgramDetail } from "./program-detail";

export default async function ProgramDetailPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  const supabase = await createClient();

  const { data: program, error: programError } = await getProgramById(supabase, programId);

  if (programError || !program) {
    return (
      <div className="space-y-4">
        <Link href="/schools" className="text-sm text-muted-foreground hover:underline">
          &larr; Back to Training
        </Link>
        <p className="text-destructive">Program not found.</p>
      </div>
    );
  }

  const { data: enrollments } = await getEnrollmentsByProgram(supabase, programId);
  const { data: grades } = await getGradesByProgram(supabase, programId);

  const { data: questions } = await getQuestionsByProgram(supabase, programId);
  const { data: responses } = await getResponsesByProgram(supabase, programId);
  const { data: referenceSlots } = await getReferenceSlotsByProgram(supabase, programId);
  const { data: referenceQuestions } = await getReferenceQuestionsByProgram(supabase, programId);

  const applicationIds = (responses ?? []).map((r: any) => r.id);
  const { data: refRequests } = await getReferenceRequestSummaries(supabase, applicationIds);

  // Fetch all users for the enrollment selector
  const { data: allUsers } = await supabase
    .from("users")
    .select("id, first_name, last_name, preferred_name, email")
    .eq("is_active", true)
    .order("last_name", { ascending: true });

  // Fetch staff pool — anyone with a schools.* permission for this
  // specific program (or any schools.* permission granted globally).
  // Includes the dedicated schools.assignable_as_contact key plus the
  // broader admin/manage permissions, which already imply the user is
  // trusted with this program.
  const staffOptions = await fetchAssignableContacts(createAdminClient(), programId);

  return (
    <div className="space-y-6">
      <ProgramDetail
        program={program}
        enrollments={enrollments ?? []}
        grades={grades ?? []}
        allUsers={allUsers ?? []}
        staffOptions={staffOptions}
        questions={questions ?? []}
        responses={responses ?? []}
        referenceSlots={referenceSlots ?? []}
        referenceQuestions={referenceQuestions ?? []}
        refRequestSummaries={refRequests ?? []}
      />
    </div>
  );
}
