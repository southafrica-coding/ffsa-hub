import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCourse, updateCourse, deleteCourse } from "@/services/schools";
import { gradeMarksRestrictMessage } from "@/lib/schools/lms-http";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { program_id, name, code, description, credit_hours, sort_order } = body;

  if (!program_id || !name || !code) {
    return NextResponse.json(
      { error: "program_id, name, and code are required" },
      { status: 400 }
    );
  }

  const { data, error } = await createCourse(supabase, {
    program_id,
    name,
    code,
    description: description || null,
    credit_hours: credit_hours ?? 3,
    sort_order: sort_order ?? 0,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, course: data });
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
  const { id, name, code, description, credit_hours, sort_order } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { data, error } = await updateCourse(supabase, id, {
    name,
    code,
    description,
    credit_hours,
    sort_order,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, course: data });
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

  const { error } = await deleteCourse(supabase, id);

  if (error) {
    const marks = gradeMarksRestrictMessage(error);
    if (marks) {
      return NextResponse.json({ error: marks }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
