import { Masthead, MastheadAction } from "@/components/ffsa";
import { requireClassroom } from "@/lib/schools/load-classroom";
import { TemplateEditor } from "@/components/schools/lms/template-editor";

export default async function TemplateEditorPage({
  params,
}: {
  params: Promise<{ programId: string; templateId: string }>;
}) {
  const { programId, templateId } = await params;
  const { program, canSaveBaseWide } = await requireClassroom(programId);
  const isNew = templateId === "new";

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`${program.name} · templates`}
        title={isNew ? "New template" : "Edit template"}
        actions={<MastheadAction href={`/schools/${programId}/classroom/templates`}>Library</MastheadAction>}
      />
      <TemplateEditor programId={programId} templateId={isNew ? null : templateId} canSaveBaseWide={canSaveBaseWide} />
    </div>
  );
}
