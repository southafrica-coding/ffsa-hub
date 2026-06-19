import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProgramById } from "@/services/schools";
import {
  getBillingCourseById,
  getEnrolledStudentsForProgram,
  getBillingPlansForCourse,
} from "@/services/school-billing";
import { CourseBillingClient } from "./course-billing-client";

export default async function CourseSchedulesPage({
  params,
}: {
  params: Promise<{ programId: string; courseId: string }>;
}) {
  const { programId, courseId } = await params;
  const supabase = await createClient();

  const [{ data: program }, { data: course }] = await Promise.all([
    getProgramById(supabase, programId),
    getBillingCourseById(supabase, courseId),
  ]);

  if (!program || !course) {
    return (
      <div className="space-y-4">
        <Link
          href={`/finance/school-fees/${programId}/billing`}
          className="text-sm text-muted-foreground hover:underline"
        >
          &larr; Back
        </Link>
        <p className="text-destructive">Course not found.</p>
      </div>
    );
  }

  const [{ data: students }, { data: plans }] = await Promise.all([
    getEnrolledStudentsForProgram(supabase, programId),
    getBillingPlansForCourse(supabase, courseId),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: items } = await (supabase as any)
    .from("fee_charge_items")
    .select("tier")
    .eq("course_id", courseId)
    .eq("active", true);
  const configuredTiers = Array.from(
    new Set((items ?? []).map((i: { tier: string }) => i.tier))
  );

  return (
    <div className="space-y-6">
      <Link
        href={`/finance/school-fees/${programId}/billing`}
        className="text-sm text-muted-foreground hover:underline"
      >
        &larr; Back to {program.name} courses
      </Link>

      <div>
        <p className="page-eyebrow">FINANCIAL MANAGEMENT</p>
        <h1 className="page-title">
          {course.name} — Student Schedules
        </h1>
        <p className="text-sm text-muted-foreground">
          Build each student&apos;s payment schedule for this course. Preview
          before saving — nothing is sent to Xero at this stage.
        </p>
      </div>

      <CourseBillingClient
        courseId={courseId}
        hasArrivalDate={!!course.arrival_date}
        configuredTiers={configuredTiers as string[]}
        students={
          (students ?? []) as Parameters<typeof CourseBillingClient>[0]["students"]
        }
        plans={(plans ?? []) as Parameters<typeof CourseBillingClient>[0]["plans"]}
      />
    </div>
  );
}
