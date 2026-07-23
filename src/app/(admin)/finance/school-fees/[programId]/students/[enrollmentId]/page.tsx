import { createClient } from "@/lib/supabase/server";
import { getProgramById } from "@/services/schools";
import {
  getBillingCoursesByProgram,
  getBillingPlansForEnrollment,
} from "@/services/school-billing";
import { StudentProgramBilling } from "./student-program-billing";

const studentName = (u: {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}) =>
  `${u.preferred_name || u.first_name || ""} ${u.last_name || ""}`.trim() ||
  "Unknown";

export default async function StudentBillingPage({
  params,
}: {
  params: Promise<{ programId: string; enrollmentId: string }>;
}) {
  const { programId, enrollmentId } = await params;
  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: enrollment } = await (supabase as any)
    .from("enrollments")
    .select(
      "id, program_id, users!enrollments_user_id_fkey(id, first_name, last_name, preferred_name, nationality)"
    )
    .eq("id", enrollmentId)
    .single();

  const { data: program } = await getProgramById(supabase, programId);

  if (!enrollment || !program) {
    return (
      <div className="space-y-4">
        <p className="text-destructive">Student or program not found.</p>
      </div>
    );
  }

  const [{ data: courses }, { data: plans }] = await Promise.all([
    getBillingCoursesByProgram(supabase, programId),
    getBillingPlansForEnrollment(supabase, enrollmentId),
  ]);

  // Does this program have whole-program pricing configured?
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: wholeProgramCharges } = await (supabase as any)
    .from("program_charge_items")
    .select("id", { count: "exact", head: true })
    .eq("program_id", programId);
  const hasWholeProgram = (wholeProgramCharges ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="page-eyebrow">FINANCIAL MANAGEMENT</p>
        <h1 className="page-title">{studentName(enrollment.users)}</h1>
        <p className="text-sm text-muted-foreground">
          {program.name} · choose phases — billing auto-trims to match. Preview
          before saving; nothing goes to Xero yet.
        </p>
      </div>

      <StudentProgramBilling
        enrollmentId={enrollmentId}
        nationality={enrollment.users?.nationality ?? null}
        hasWholeProgram={hasWholeProgram}
        courses={
          (courses ?? []) as Parameters<
            typeof StudentProgramBilling
          >[0]["courses"]
        }
        plans={(plans ?? []) as Parameters<typeof StudentProgramBilling>[0]["plans"]}
      />
    </div>
  );
}
