import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProgramById } from "@/services/schools";
import { getBillingCoursesByProgram } from "@/services/school-billing";
import { Masthead } from "@/components/ffsa";
import { ProgramBillingClient } from "./program-billing-client";

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

      <div className="space-y-6 px-8 py-7">
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
