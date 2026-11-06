import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEnrollmentById, getGradesByEnrollment } from "@/services/schools";
import { Masthead, MastheadAction } from "@/components/ffsa";
import { StudentCourseStats } from "@/components/schools/lms/student-course-view";
import { StudentOutline } from "@/components/schools/lms/student-outline";

type CourseRow = {
  id: string;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  credit_hours?: number | null;
  graded?: boolean | null;
  status?: string | null;
  start_date?: string | null;
};

export default async function StudentCoursePage({
  params,
}: {
  params: Promise<{ enrollmentId: string; courseId: string }>;
}) {
  const { enrollmentId, courseId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await getEnrollmentById(supabase, enrollmentId);
  if (error || !data || data.user_id !== user.id) notFound();

  const rawProgram = data.programs as
    | {
        id: string;
        name: string;
        code: string;
        courses?: CourseRow[] | CourseRow | null;
      }
    | Array<{
        id: string;
        name: string;
        code: string;
        courses?: CourseRow[] | CourseRow | null;
      }>
    | null;
  const program = Array.isArray(rawProgram) ? rawProgram[0] : rawProgram;
  if (!program?.id) notFound();
  const courses = Array.isArray(program.courses) ? program.courses : program.courses ? [program.courses] : [];
  const course = courses.find((row) => row.id === courseId);
  if (!course) notFound();

  const { data: grades } = await getGradesByEnrollment(supabase, enrollmentId);
  const letter =
    (grades ?? []).find((grade: { course_id: string; letter_grade: string | null }) => grade.course_id === courseId)
      ?.letter_grade ?? null;
  const shape = {
    code: course.code ?? "",
    name: course.name ?? "Course",
    startDate: course.start_date ?? null,
    graded: course.graded !== false,
    status: course.status ?? null,
    creditHours: course.credit_hours ?? 0,
    description: course.description ?? null,
  };

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`${program.code} · ${shape.code}`}
        title={shape.name}
        actions={<MastheadAction href={`/my-schools/${enrollmentId}`}>My grades</MastheadAction>}
      />
      <StudentCourseStats course={shape} officialLetter={letter} />
      <StudentOutline programId={program.id} courseId={course.id} course={shape} />
    </div>
  );
}
