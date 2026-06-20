import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProgramById } from "@/services/schools";
import {
  getBillingCourseById,
  getEnrolledStudentsForProgram,
  getBillingPlansForCourse,
} from "@/services/school-billing";
import { CourseDetailPanel } from "./course-detail-panel";
import { CourseBillingClient } from "./course-billing-client";

const nameOf = (u: {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}) =>
  `${u.preferred_name || u.first_name || ""} ${u.last_name || ""}`.trim() ||
  "Unknown";

export default async function CourseDetailPage({
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
  const db = supabase as any;
  const { data: items } = await db
    .from("fee_charge_items")
    .select("tier")
    .eq("course_id", courseId)
    .eq("active", true);
  const configuredTiers = Array.from(
    new Set((items ?? []).map((i: { tier: string }) => i.tier))
  );

  const { data: staff } = await db
    .from("users")
    .select("id, first_name, last_name, preferred_name")
    .order("first_name", { ascending: true })
    .limit(500);

  // Roster = students who have a billing plan for this phase.
  type Student = {
    user_id: string;
    users: {
      first_name: string | null;
      last_name: string | null;
      preferred_name: string | null;
    };
  };
  const studentByUser: Record<string, Student> = {};
  for (const s of (students ?? []) as Student[]) studentByUser[s.user_id] = s;
  const roster = ((plans ?? []) as {
    user_id: string;
    tier: string;
    student_billing_schedule: unknown[] | null;
  }[]).map((p) => ({
    name: studentByUser[p.user_id] ? nameOf(studentByUser[p.user_id].users) : "Unknown",
    tier: p.tier,
    scheduled: p.student_billing_schedule?.length ?? 0,
  }));

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
        <h1 className="page-title">{course.name}</h1>
        <p className="text-sm text-muted-foreground">
          {program.name} · course detail, roster, and per-student schedules.
        </p>
      </div>

      <CourseDetailPanel
        course={course as Parameters<typeof CourseDetailPanel>[0]["course"]}
        staff={(staff ?? []) as Parameters<typeof CourseDetailPanel>[0]["staff"]}
        roster={roster}
      />

      <div>
        <h2 className="text-lg font-semibold mb-1">Per-student schedules</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Build this single course&apos;s schedule per student. For whole-program
          students, use Student Billing instead.
        </p>
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
    </div>
  );
}
