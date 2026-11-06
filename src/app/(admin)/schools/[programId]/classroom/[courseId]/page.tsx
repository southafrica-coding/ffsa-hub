import { Masthead, MastheadAction } from "@/components/ffsa";
import { classroomHref } from "@/lib/schools/lms-api";
import { loadClassroomCourse, loadPeople, requireClassroom } from "@/lib/schools/load-classroom";
import { CourseBuilder } from "@/components/schools/lms/course-builder";

export default async function CourseBuilderPage({
  params,
}: {
  params: Promise<{ programId: string; courseId: string }>;
}) {
  const { programId, courseId } = await params;
  const { program } = await requireClassroom(programId);
  const [course, staff] = await Promise.all([loadClassroomCourse(programId, courseId), loadPeople()]);
  if (!course) {
    return (
      <div className="ffsa-screen">
        <Masthead context={program.code} title="Course not found" actions={<MastheadAction href={classroomHref(programId)}>Classroom</MastheadAction>} />
      </div>
    );
  }

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`${program.name} · ${course.code}`}
        title={course.name}
        actions={<MastheadAction href={classroomHref(programId)}>Classroom</MastheadAction>}
      />
      <CourseBuilder programId={programId} programName={program.name} course={course} staff={staff} />
    </div>
  );
}
