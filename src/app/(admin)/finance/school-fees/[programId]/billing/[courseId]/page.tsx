import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireSchoolFeesAccess } from "@/lib/finance/school-fees-links";
import { getProgramById } from "@/services/schools";
import {
  getBillingCourseById,
  getEnrolledStudentsForProgram,
  getBillingPlansForCourse,
} from "@/services/school-billing";
import { Masthead, SectionBar } from "@/components/ffsa";
import { CourseDetailPanel } from "./course-detail-panel";
import { CourseBillingClient } from "./course-billing-client";

const nameOf = (u: {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}) =>
  `${u.first_name || ""} ${u.last_name || ""}`.trim() ||
  "Unknown";

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ programId: string; courseId: string }>;
}) {
  const { programId, courseId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireSchoolFeesAccess(supabase, user.id);

  const [{ data: program }, { data: course }] = await Promise.all([
    getProgramById(supabase, programId),
    getBillingCourseById(supabase, courseId),
  ]);

  if (!program || !course) {
    return (
      <div className="ffsa-screen">
        <p className="px-5 py-8 text-sm text-destructive md:px-8">Course not found.</p>
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
    <div className="ffsa-screen">
      <Masthead context={`School fees · ${program.name}`} title={course.name} />

      <div className="space-y-6 px-5 py-6 md:px-8 md:py-7">
        <CourseDetailPanel
          course={course as Parameters<typeof CourseDetailPanel>[0]["course"]}
          staff={(staff ?? []) as Parameters<typeof CourseDetailPanel>[0]["staff"]}
          roster={roster}
        />

        <div className="border border-ink">
          <SectionBar title="Per-student schedules" />
          <div className="p-6">
            <p className="mb-4 max-w-3xl text-[13px] text-[color:var(--text-secondary)]">
              Build this single course&apos;s schedule per student. For
              whole-program students, use Student Billing instead.
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
      </div>
    </div>
  );
}
