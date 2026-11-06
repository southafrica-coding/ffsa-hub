import { Masthead, MastheadAction } from "@/components/ffsa";
import { classroomHref } from "@/lib/schools/lms-api";
import { requireClassroom } from "@/lib/schools/load-classroom";
import { TemplateLibrary } from "@/components/schools/lms/template-library";

export default async function TemplateLibraryPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { program, canSaveBaseWide } = await requireClassroom(programId);

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`${program.name} · templates`}
        title="Template library"
        actions={<MastheadAction href={classroomHref(programId)}>Classroom</MastheadAction>}
      />
      <TemplateLibrary programId={programId} programName={program.name} canSaveBaseWide={canSaveBaseWide} />
    </div>
  );
}
