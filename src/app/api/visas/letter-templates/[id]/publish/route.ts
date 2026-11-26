import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getVisaLetterTemplateById, publishVisaLetterTemplate } from "@/services/visas";
import { isUuid, refusePreviewWrite, rpcErrorResponse } from "@/lib/visas/api";
import { isLetterKind, templateProblems } from "@/lib/visas/letters";

// POST — global legal publishes a draft: it becomes the version used for
// new letters, and the version before it is retired. Refused while the
// draft has problems (unknown fields, no repatriation undertaking...).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const refusal = refusePreviewWrite();
  if (refusal) return refusal;
  if (!isUuid(id)) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const { data: template } = await getVisaLetterTemplateById(supabase, id);
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  const problems = isLetterKind(template.kind) ? templateProblems(template.kind, template.body) : ["Unknown letter"];
  if (problems.length > 0) {
    return NextResponse.json({ error: "Fix the template first", problems }, { status: 400 });
  }

  const { error } = await publishVisaLetterTemplate(supabase, id);
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ success: true });
}
