import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProgramById } from "@/services/schools";
import { getBillingCoursesByProgram } from "@/services/school-billing";
import { Masthead } from "@/components/ffsa";
import { canManageFinance } from "@/lib/api-auth";
import { ProgramBillingClient } from "./program-billing-client";
import { SchoolBillingSettings } from "./school-billing-settings";

export default async function ProgramBillingPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  const supabase = await createClient();

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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const canEdit = user ? await canManageFinance(supabase, user.id) : false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: pendingCharges } = await (supabase as any)
    .from("student_billing_schedule")
    .select("id, student_billing_plans!inner(program_id)", { count: "exact", head: true })
    .eq("student_billing_plans.program_id", programId)
    .eq("status", "scheduled");

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`School fees · ${program.name}`}
        title="Courses"
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
        <SchoolBillingSettings
          programId={programId}
          schoolName={program.name}
          canEdit={canEdit}
          pendingCharges={pendingCharges ?? 0}
          initial={{
            // Columns absent (172 unapplied) read as external — the safe side.
            billing_mode: program.billing_mode === "hub_scheduled" ? "hub_scheduled" : "external",
            billing_emails_enabled: program.billing_emails_enabled === true,
            schedule_start_date: program.schedule_start_date ?? null,
          }}
        />

        <p className="max-w-3xl text-[13px] text-[color:var(--text-secondary)]">
          The phases (courses) within this program, each with its own timeframe
          and per-tier charges. The phases together make up the full program;
          students are billed the whole program and auto-trimmed to the phases
          they&apos;re doing.
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
    </div>
  );
}
