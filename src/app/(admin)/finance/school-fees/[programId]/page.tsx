import { createClient } from "@/lib/supabase/server";
import { getProgramById } from "@/services/schools";
import {
  getFeeStructuresByProgram,
  getStudentFeesByProgram,
  getProgramFeeSummary,
  getPaymentsByProgram,
} from "@/services/school-fees";
import { ProgramFeesDetail } from "./program-fees-detail";

export default async function ProgramFeesPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  const supabase = await createClient();

  const { data: program, error: programError } = await getProgramById(
    supabase,
    programId
  );

  if (programError || !program) {
    return (
      <div className="ffsa-screen">
        <p className="px-5 py-8 text-sm text-destructive md:px-8">Program not found.</p>
      </div>
    );
  }

  const [
    { data: feeStructures },
    { data: studentFees },
    { data: payments },
    summary,
  ] = await Promise.all([
    getFeeStructuresByProgram(supabase, programId),
    getStudentFeesByProgram(supabase, programId),
    getPaymentsByProgram(supabase, programId),
    getProgramFeeSummary(supabase, programId),
  ]);

  // Get enrolled students without fees (for tier assignment)
  const { data: enrollments, error: enrollError } = await supabase
    .from("enrollments")
    .select("id, user_id, status, users!enrollments_user_id_fkey(id, first_name, last_name, preferred_name, nationality)")
    .eq("program_id", programId)
    .in("status", ["active", "on_hold"]);

  if (enrollError) {
    console.error("Failed to fetch enrollments:", enrollError.message);
  }

  const feeEnrollmentIds = new Set(
    (studentFees ?? []).map((f: { enrollment_id: string }) => f.enrollment_id)
  );
  const studentsWithoutFees = (enrollments ?? []).filter(
    (e: { id: string }) => !feeEnrollmentIds.has(e.id)
  );

  // No wrapper: ProgramFeesDetail's root is this screen's root, and the
  // "Billing schedules" link lives in that component's masthead.
  return (
    <ProgramFeesDetail
      program={program}
      feeStructures={feeStructures ?? []}
      studentFees={studentFees ?? []}
      countryTiers={[]}
      payments={payments ?? []}
      studentsWithoutFees={studentsWithoutFees as unknown as Parameters<typeof ProgramFeesDetail>[0]["studentsWithoutFees"]}
      summary={summary}
    />
  );
}
