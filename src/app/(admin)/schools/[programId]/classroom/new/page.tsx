import { Masthead, MastheadAction } from "@/components/ffsa";
import { classroomHref } from "@/lib/schools/lms-api";
import { requireClassroom } from "@/lib/schools/load-classroom";
import { CourseShellForm } from "@/components/schools/lms/course-shell-form";

export default async function NewCoursePage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { program } = await requireClassroom(programId);

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`${program.name} · training`}
        title="New course"
        actions={<MastheadAction href={classroomHref(programId)}>Classroom</MastheadAction>}
      />
      <CourseShellForm programId={programId} course={null} />
    </div>
  );
}
