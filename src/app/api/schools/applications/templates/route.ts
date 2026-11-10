import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageApplicationTemplates } from "@/lib/auth/application-template-access";
import {
  getApplicationTemplates,
  getApplicationTemplate,
  createApplicationTemplate,
  createTemplateQuestion,
  deleteApplicationTemplate,
  getQuestionsByProgram,
  createQuestion,
} from "@/services/schools";

// Migration 316: creating or deleting a template needs an active unscoped
// admin, or an unscoped schools.manage / schools.templates.manage grant.
// Reading and applying a template do not. There is no rename route today.
const TEMPLATE_FORBIDDEN = "You don't have permission to change application templates.";
const TEMPLATE_NOT_FOUND = "Template not found";

function forbidden() {
  return NextResponse.json({ error: TEMPLATE_FORBIDDEN }, { status: 403 });
}

function notFound() {
  return NextResponse.json({ error: TEMPLATE_NOT_FOUND }, { status: 404 });
}

// Best-effort. A failed question insert must not leave a template with no
// questions. A cleanup failure is logged and the original error still returns.
async function removeHalfSaved(
  supabase: Awaited<ReturnType<typeof createClient>>,
  templateId: string
) {
  try {
    const { error } = await deleteApplicationTemplate(supabase, templateId);
    if (error) {
      console.error("Failed to remove half-saved application template", templateId, error.message ?? error);
    }
  } catch (err) {
    console.error("Failed to remove half-saved application template", templateId, err);
  }
}

function writeFailure(error: { code?: string; message?: string } | null) {
  if (!error) return null;
  // RLS refused the write (Postgres insufficient_privilege) instead of
  // returning an empty result. Same answer as the upfront check.
  if (error.code === "42501") return forbidden();
  return NextResponse.json({ error: error.message ?? "Request failed" }, { status: 500 });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await getApplicationTemplates(supabase);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ templates: data });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const { action } = body;

  if (action === "save_from_program") {
    if (!(await canManageApplicationTemplates(supabase, user.id))) return forbidden();

    const { program_id, name, description } = body;
    if (!program_id || !name) {
      return NextResponse.json({ error: "program_id and name are required" }, { status: 400 });
    }

    const { data: questions } = await getQuestionsByProgram(supabase, program_id);
    if (!questions || questions.length === 0) {
      return NextResponse.json({ error: "No questions to save as template" }, { status: 400 });
    }

    const { data: template, error: tErr } = await createApplicationTemplate(supabase, {
      name,
      description: description || null,
      created_by: user.id,
    });
    const templateDenied = writeFailure(tErr);
    if (templateDenied) return templateDenied;
    if (!template) return NextResponse.json({ error: "Failed to save template" }, { status: 500 });

    // Templates have their own question IDs, so we have to insert parents first,
    // capture the new IDs, then insert follow-ups with remapped parent IDs.
    const programIdToTemplateId = new Map<string, string>();
    const topLevel = (questions as any[]).filter((q) => !q.parent_question_id);
    const followUps = (questions as any[]).filter((q) => q.parent_question_id);

    for (let i = 0; i < topLevel.length; i++) {
      const q = topLevel[i];
      const { data: inserted, error } = await createTemplateQuestion(supabase, {
        template_id: template.id,
        label: q.label,
        description: q.description || null,
        type: q.type,
        sort_order: q.sort_order ?? i,
        is_required: q.is_required,
        options: q.options ?? [],
      });
      if (error || !inserted) {
        await removeHalfSaved(supabase, template.id);
        const questionDenied = writeFailure(error);
        if (questionDenied) return questionDenied;
        return NextResponse.json({ error: "Failed to save template question" }, { status: 500 });
      }
      programIdToTemplateId.set(q.id, inserted.id);
    }

    // Follow-ups may themselves be parents of other follow-ups (nesting).
    // Insert in passes until every question's parent has a mapped ID.
    let remaining = [...followUps];
    while (remaining.length > 0) {
      const nextPass: any[] = [];
      let inserted = 0;
      for (const q of remaining) {
        const mappedParent = programIdToTemplateId.get(q.parent_question_id);
        if (!mappedParent) {
          nextPass.push(q);
          continue;
        }
        const { data: row, error } = await createTemplateQuestion(supabase, {
          template_id: template.id,
          label: q.label,
          description: q.description || null,
          type: q.type,
          sort_order: q.sort_order ?? 0,
          is_required: q.is_required,
          options: q.options ?? [],
          parent_question_id: mappedParent,
          show_when_answer: q.show_when_answer,
        });
        if (error || !row) {
          await removeHalfSaved(supabase, template.id);
          const followUpDenied = writeFailure(error);
          if (followUpDenied) return followUpDenied;
          return NextResponse.json({ error: "Failed to save template question" }, { status: 500 });
        }
        programIdToTemplateId.set(q.id, row.id);
        inserted++;
      }
      if (inserted === 0 && nextPass.length > 0) {
        // Parents missing — orphaned follow-ups. Skip them rather than infinite loop.
        break;
      }
      remaining = nextPass;
    }

    return NextResponse.json({ success: true, template });
  }

  if (action === "import_to_program") {
    const { template_id, program_id } = body;
    if (!template_id || !program_id) {
      return NextResponse.json({ error: "template_id and program_id are required" }, { status: 400 });
    }

    const { data: template, error: tErr } = await getApplicationTemplate(supabase, template_id);
    if (tErr || !template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const { data: existing } = await getQuestionsByProgram(supabase, program_id);
    const startOrder = existing?.length ?? 0;

    const tQuestions = template.application_template_questions ?? [];
    const templateIdToProgramId = new Map<string, string>();

    const topLevel = tQuestions.filter((q: any) => !q.parent_question_id);
    const followUps = tQuestions.filter((q: any) => q.parent_question_id);

    for (let i = 0; i < topLevel.length; i++) {
      const q = topLevel[i];
      const { data: row, error } = await createQuestion(supabase, {
        program_id,
        label: q.label,
        description: q.description || null,
        type: q.type,
        sort_order: startOrder + i,
        is_required: q.is_required,
        options: q.options ?? [],
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      templateIdToProgramId.set(q.id, row.id);
    }

    let remaining = [...followUps];
    while (remaining.length > 0) {
      const nextPass: any[] = [];
      let inserted = 0;
      for (const q of remaining) {
        const mappedParent = templateIdToProgramId.get(q.parent_question_id);
        if (!mappedParent) {
          nextPass.push(q);
          continue;
        }
        const { data: row, error } = await createQuestion(supabase, {
          program_id,
          label: q.label,
          description: q.description || null,
          type: q.type,
          sort_order: q.sort_order ?? 0,
          is_required: q.is_required,
          options: q.options ?? [],
          parent_question_id: mappedParent,
          show_when_answer: q.show_when_answer,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        templateIdToProgramId.set(q.id, row.id);
        inserted++;
      }
      if (inserted === 0 && nextPass.length > 0) break;
      remaining = nextPass;
    }

    return NextResponse.json({ success: true, imported: tQuestions.length });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!(await canManageApplicationTemplates(supabase, user.id))) return forbidden();

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // The caller's own client. A missing id and a row this user cannot read
  // look the same, so both are 404. A row they can read but cannot delete
  // is 403.
  const { data: existing, error: readError } = await getApplicationTemplate(supabase, id);
  if (readError?.code === "42501" || readError?.code === "PGRST116" || !existing) {
    if (readError && readError.code !== "42501" && readError.code !== "PGRST116") {
      return NextResponse.json({ error: readError.message }, { status: 500 });
    }
    return notFound();
  }

  const { data, error } = await deleteApplicationTemplate(supabase, id);
  const denied = writeFailure(error);
  if (denied) return denied;
  // Readable, but RLS filtered the delete down to zero rows.
  if (!Array.isArray(data) || data.length === 0) return forbidden();

  return NextResponse.json({ success: true });
}
