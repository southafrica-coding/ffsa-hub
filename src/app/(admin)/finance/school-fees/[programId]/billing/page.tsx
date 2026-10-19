import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { getProgramById } from "@/services/schools";
import { getBillingCoursesByProgram } from "@/services/school-billing";
import { Masthead } from "@/components/ffsa";
import { ProgramBillingClient } from "./program-billing-client";
import { SchoolFeesPanel } from "@/components/finance/school-fees-panel";

export default async function ProgramBillingPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "finance");

  const { data: program, error } = await getProgramById(supabase, programId);
  if (error || !program) {
    return (
      <div className="ffsa-screen">
        <p className="px-5 py-8 text-sm text-destructive md:px-8">Program not found.</p>
      </div>
    );
  }

  const { data: courses } = await getBillingCoursesByProgram(supabase, programId);

  // All charge items across this program's courses, grouped by course_id.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: items } = await (supabase as any)
    .from("fee_charge_items")
    .select("*, billing_courses!inner(program_id)")
    .eq("billing_courses.program_id", programId)
    .order("tier", { ascending: true })
    .order("sort_order", { ascending: true });

  const itemsByCourse: Record<string, unknown[]> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const item of (items ?? []) as any[]) {
    (itemsByCourse[item.course_id] ??= []).push(item);
  }

  // Whole-program (program-level) charges.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: programItems } = await (supabase as any)
    .from("program_charge_items")
    .select("*")
    .eq("program_id", programId)
    .order("tier", { ascending: true })
    .order("sort_order", { ascending: true });

  // Per-school billing switches + how many charges are still waiting on a run.
  return (
    <div className="ffsa-screen">
      <Masthead
        context={`School fees · ${program.name}`}
        title="Fees & billing"
        actions={
          <Link
            href={`/finance/school-fees/${programId}/students`}
            className="inline-block shrink-0 border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white"
          >
            Student billing &rarr;
          </Link>
        }
      />

      <div className="space-y-6 px-4 py-7 md:px-8">
        <SchoolFeesPanel programId={programId} showFinanceLinks={false} />

        {/* The raw per-charge editor. Saving a payment schedule above
            replaces these for that pricing, so it's tucked away. */}
        <details className="border border-rule-strong bg-white">
          <summary className="cursor-pointer px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em]">
            Advanced: individual charges
          </summary>
          <div className="space-y-3 border-t border-rule px-4 py-4">
            <p className="max-w-3xl text-[13px] text-[color:var(--text-secondary)]">
              The charges the payment schedules above compile into, editable one by one. A change
              here is overwritten the next time that schedule is saved.
            </p>
        <ProgramBillingClient
          programId={programId}
          courses={
            (courses ?? []) as Parameters<typeof ProgramBillingClient>[0]["courses"]
          }
          itemsByCourse={
            itemsByCourse as Parameters<typeof ProgramBillingClient>[0]["itemsByCourse"]
          }
          programItems={
            (programItems ?? []) as Parameters<
              typeof ProgramBillingClient
            >[0]["programItems"]
          }
        />
          </div>
        </details>
      </div>
    </div>
  );
}
