import { Masthead, MastheadAction, NeedsYou } from "@/components/ffsa";
import { classroomHref } from "@/lib/schools/lms-api";
import { loadGradingQueue, requireClassroom } from "@/lib/schools/load-classroom";
import { GraderQueue } from "@/components/schools/lms/grader-queue";

export default async function GradingPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { program, userId } = await requireClassroom(programId);
  const { students, official } = await loadGradingQueue(programId);
  const open = students.reduce((sum, student) => {
    return (
      sum +
      student.courses.filter(
        (course) => !official.some((row) => row.enrollmentId === student.enrollmentId && row.courseId === course.id && row.letter)
      ).length
    );
  }, 0);

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`${program.name} · grading`}
        title="Grader queue"
        actions={<MastheadAction href={classroomHref(programId)}>Classroom</MastheadAction>}
      />
      {open > 0 ? (
        <NeedsYou>
          {open === 1 ? "1 official letter is still open." : `${open} official letters are still open.`}
        </NeedsYou>
      ) : null}
      <GraderQueue programId={programId} viewerId={userId} students={students} official={official} />
    </div>
  );
}
