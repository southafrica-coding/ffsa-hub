import { createClient } from "@/lib/supabase/server";
import { getProgramById } from "@/services/schools";
import {
  getBillingCoursesByProgram,
  getBillingPlansForEnrollment,
} from "@/services/school-billing";
import { Masthead } from "@/components/ffsa";
import { StudentProgramBilling } from "./student-program-billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSchoolBalances } from "@/services/school-balances";
import { StudentFeeDetail } from "@/components/finance/student-fee-detail";
import { RefreshPaymentsButton } from "@/components/finance/refresh-payments-button";
import { canManageFinance } from "@/lib/api-auth";

const studentName = (u: {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}) =>
  `${u.first_name || ""} ${u.last_name || ""}`.trim() ||
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
      <div className="ffsa-screen">
        <p className="px-5 py-8 text-sm text-destructive md:px-8">Student or program not found.</p>
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

  const balances = await getSchoolBalances(createAdminClient(), programId, { enrollmentId });
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();
  const canInvoice = viewer ? await canManageFinance(supabase, viewer.id) : false;
  const mine = balances.byEnrollment.get(enrollmentId);

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`School fees · ${program.name}`}
        title={studentName(enrollment.users)}
        actions={<RefreshPaymentsButton programId={programId} />}
      />

      <div className="space-y-6 px-4 py-7 md:px-8">
        {mine && (
          <StudentFeeDetail
            balance={mine.balance}
            charges={mine.charges}
            today={balances.today}
            enrollmentId={enrollmentId}
            canEdit={canInvoice}
          />
        )}

        <p className="max-w-3xl text-[13px] text-[color:var(--text-secondary)]">
          Choose phases — billing auto-trims to match. Preview before saving;
          nothing goes to Xero yet.
        </p>

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
    </div>
  );
}
