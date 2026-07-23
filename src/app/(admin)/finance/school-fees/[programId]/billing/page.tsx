import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProgramById } from "@/services/schools";
import { getBillingCoursesByProgram } from "@/services/school-billing";
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
      <div className="space-y-4">
        <p className="text-destructive">Program not found.</p>
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
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="page-eyebrow">FINANCIAL MANAGEMENT</p>
          <h1 className="page-title">{program.name} — Courses</h1>
          <p className="text-sm text-muted-foreground">
            The phases (courses) within this program, each with its own
            timeframe and per-tier charges. The phases together make up the
            full program; students are billed the whole program and auto-trimmed
            to the phases they&apos;re doing.
          </p>
        </div>
        <Link
          href={`/finance/school-fees/${programId}/students`}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors shrink-0"
        >
          Student billing &rarr;
        </Link>
      </div>

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
  );
}
