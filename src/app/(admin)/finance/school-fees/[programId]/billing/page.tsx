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
        <Link
          href="/finance/school-fees"
          className="text-sm text-muted-foreground hover:underline"
        >
          &larr; Back to School Fees
        </Link>
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

  return (
    <div className="space-y-6">
      <Link
        href="/finance/school-fees"
        className="text-sm text-muted-foreground hover:underline"
      >
        &larr; Back to School Fees
      </Link>

      <div>
        <p className="page-eyebrow">FINANCIAL MANAGEMENT</p>
        <h1 className="page-title">{program.name} — Courses</h1>
        <p className="text-sm text-muted-foreground">
          The chronological courses within this program. Each course has its own
          timeframe and per-tier charge items, and its own student billing
          schedules. Students enrol in the whole year or a single course.
        </p>
      </div>

      <ProgramBillingClient
        programId={programId}
        courses={
          (courses ?? []) as Parameters<typeof ProgramBillingClient>[0]["courses"]
        }
        itemsByCourse={
          itemsByCourse as Parameters<typeof ProgramBillingClient>[0]["itemsByCourse"]
        }
      />
    </div>
  );
}
