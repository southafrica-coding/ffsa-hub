import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Masthead } from "@/components/ffsa";
import { getVisaAccess } from "@/lib/visas/access";
import { LETTER_KIND_LABEL, isLetterKind } from "@/lib/visas/letters";
import { getProgramNames, getVisaLetterTemplates } from "@/services/visas";
import { TemplateEditor, type TemplateVersion } from "./template-editor";

// Edit one letter (kind + school): the draft if there is one, otherwise a
// new draft starting from the version in use. Global legal only.

export default async function EditLetterTemplatePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; program?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await getVisaAccess(supabase, user.id);
  if (!access.globalLegal) redirect("/schools/visas");

  const { kind, program } = await searchParams;
  if (!isLetterKind(kind)) redirect("/schools/visas/letters");
  const programId = program && /^[0-9a-f-]{36}$/i.test(program) ? program : null;
  if (kind === "invitation" && !programId) redirect("/schools/visas/letters");

  const [{ data: all }, { data: programs }] = await Promise.all([
    getVisaLetterTemplates(supabase),
    getProgramNames(supabase, programId ? [programId] : []),
  ]);
  const versions = ((all ?? []) as Array<TemplateVersion & { kind: string; program_id: string | null }>).filter(
    (t) => t.kind === kind && (t.program_id ?? null) === programId
  );
  const school = programId ? (((programs ?? []) as Array<{ name: string }>)[0]?.name ?? "School") : null;
  const draft = versions.find((v) => v.status === "draft") ?? null;
  const current = versions.find((v) => v.status === "current") ?? null;

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`Visas · Letter templates · ${school ?? "Any school"}`}
        title={LETTER_KIND_LABEL[kind]}
        actions={
          <Link href="/schools/visas/letters" className="mono-label underline-offset-4 hover:underline">
            All letters
          </Link>
        }
      />
      <TemplateEditor
        kind={kind}
        programId={programId}
        school={school}
        draft={draft}
        current={current}
        versions={versions}
      />
    </div>
  );
}
