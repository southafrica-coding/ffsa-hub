import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lmsRestrictMessage } from "@/lib/schools/lms-assignments-auth";
import {
  canCreateProgram,
  getAccessibleSchoolsProgramIds,
} from "@/lib/auth/schools-program-access";
import {
  createProgram,
  updateProgram,
  deleteProgram,
  seedDefaultReferenceQuestions,
} from "@/services/schools";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Creating a school is org-wide. A program-scoped grant does not reach it.
  const schools = await getAccessibleSchoolsProgramIds(supabase, user.id);
  if (!canCreateProgram(schools)) {
    return NextResponse.json({ error: "You don't have permission to create a program" }, { status: 403 });
  }

  const body = await request.json();
  const { name, code, description, credit_hours } = body;

  if (!name || !code) {
    return NextResponse.json(
      { error: "name and code are required" },
      { status: 400 }
    );
  }

  const { data, error } = await createProgram(supabase, {
    name,
    code,
    description: description || null,
    credit_hours: credit_hours || 0,
    created_by: user.id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Drop the default reference question set onto the new program so the
  // referee form has something to render. Admins can edit/remove afterwards.
  if (data?.id) {
    await seedDefaultReferenceQuestions(supabase, data.id);
  }

  return NextResponse.json({ success: true, program: data });
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
  const { id, ...updateData } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { data, error } = await updateProgram(supabase, id, updateData);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, program: data });
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

  const { error } = await deleteProgram(supabase, id);

  if (error) {
    // Classroom submissions hold the school's enrolments and courses (migration 310).
    const restrict = lmsRestrictMessage(error, "program");
    if (restrict) return NextResponse.json({ error: restrict }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
