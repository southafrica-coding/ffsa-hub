import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { createQuestion, updateQuestion, deleteQuestion } from "@/services/schools";

// Program staff (migration 304) fail userCanManageProgram, so they cannot
// edit the form even though they can review applicants assigned to them.
async function denyUnlessManager(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  programId: string | null | undefined
) {
  if (!programId) {
    return NextResponse.json({ error: "Application question not found" }, { status: 404 });
  }
  if (!(await userCanManageProgram(supabase, userId, programId))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  return null;
}

function validateFollowUpFields(
  parent_question_id: unknown,
  show_when_answer: unknown
): string | null {
  const hasParent = !!parent_question_id;
  const hasAnswer = !!show_when_answer;
  if (hasParent !== hasAnswer) {
    return "parent_question_id and show_when_answer must be set together";
  }
  return null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { program_id, label, description, type, sort_order, is_required, options, parent_question_id, show_when_answer } = body;

  if (!program_id || !label) {
    return NextResponse.json(
      { error: "program_id and label are required" },
      { status: 400 }
    );
  }

  const followUpValidation = validateFollowUpFields(parent_question_id, show_when_answer);
  if (followUpValidation) {
    return NextResponse.json({ error: followUpValidation }, { status: 400 });
  }

  const denied = await denyUnlessManager(supabase, user.id, program_id);
  if (denied) return denied;

  const { data, error } = await createQuestion(supabase, {
    program_id,
    label,
    description: description || null,
    type: type || "short_answer",
    sort_order: sort_order ?? 0,
    is_required: is_required ?? true,
    options: options ?? [],
    parent_question_id: parent_question_id || null,
    show_when_answer: show_when_answer || null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, question: data });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { id, label, description, type, sort_order, is_required, options, parent_question_id, show_when_answer } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  if (parent_question_id !== undefined || show_when_answer !== undefined) {
    const followUpValidation = validateFollowUpFields(
      parent_question_id ?? null,
      show_when_answer ?? null
    );
    if (followUpValidation) {
      return NextResponse.json({ error: followUpValidation }, { status: 400 });
    }
    if (parent_question_id && parent_question_id === id) {
      return NextResponse.json(
        { error: "A question cannot be its own follow-up parent" },
        { status: 400 }
      );
    }
  }

  // System questions (Nationality / Home Country) are locked: their type and
  // required-ness can't change (they stay mandatory country dropdowns), and
  // they can't become follow-ups. Label / description / order stay editable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase as any)
    .from("application_questions")
    .select("is_system, program_id")
    .eq("id", id)
    .single();
  const denied = await denyUnlessManager(supabase, user.id, existing?.program_id);
  if (denied) return denied;
  const isSystem = !!existing?.is_system;

  const updateData: Record<string, unknown> = {};
  if (label !== undefined) updateData.label = label;
  if (description !== undefined) updateData.description = description;
  if (sort_order !== undefined) updateData.sort_order = sort_order;
  if (!isSystem) {
    if (type !== undefined) updateData.type = type;
    if (is_required !== undefined) updateData.is_required = is_required;
    if (options !== undefined) updateData.options = options;
    if (parent_question_id !== undefined) updateData.parent_question_id = parent_question_id || null;
    if (show_when_answer !== undefined) updateData.show_when_answer = show_when_answer || null;
  }

  const { data, error } = await updateQuestion(supabase, id, updateData);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, question: data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase as any)
    .from("application_questions")
    .select("is_system, program_id")
    .eq("id", id)
    .single();
  const denied = await denyUnlessManager(supabase, user.id, existing?.program_id);
  if (denied) return denied;
  if (existing?.is_system) {
    return NextResponse.json(
      { error: "This is a required system question and can't be deleted." },
      { status: 400 }
    );
  }

  const { error } = await deleteQuestion(supabase, id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
