import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance } from "@/lib/api-auth";
import {
  createBillingCourse,
  updateBillingCourse,
  deleteBillingCourse,
} from "@/services/school-billing";

async function guard(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      user: null,
      res: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }
  if (!(await canManageFinance(supabase, user.id))) {
    return {
      user: null,
      res: NextResponse.json(
        { error: "You don't have permission to manage finance settings" },
        { status: 403 }
      ),
    };
  }
  return { user, res: null };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { user, res } = await guard(supabase);
  if (res) return res;

  const body = await request.json();
  const { program_id, code, name } = body;
  if (!program_id || !code || !name) {
    return NextResponse.json(
      { error: "program_id, code and name are required" },
      { status: 400 }
    );
  }

  const { data, error } = await createBillingCourse(supabase, {
    program_id,
    code,
    name,
    scope: body.scope ?? "segment",
    sequence: body.sequence ?? 0,
    start_date: body.start_date || null,
    end_date: body.end_date || null,
    arrival_date: body.arrival_date || null,
    enroll_lead_days: body.enroll_lead_days ?? 30,
    created_by: user!.id,
    // Only sent when switched off, so the column's default covers the rest.
    ...(body.graded === false ? { graded: false } : {}),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, data });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const { res } = await guard(supabase);
  if (res) return res;

  const body = await request.json();
  const { id } = body;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  for (const key of [
    "code",
    "name",
    "scope",
    "sequence",
    "enroll_lead_days",
    "status",
    "notes",
    "description",
  ]) {
    if (key in body) update[key] = body[key];
  }
  if ("lead_staff_id" in body) update.lead_staff_id = body.lead_staff_id || null;
  if (typeof body.graded === "boolean") update.graded = body.graded;
  // Date fields: empty string → null
  for (const key of ["start_date", "end_date", "arrival_date"]) {
    if (key in body) update[key] = body[key] || null;
  }

  const { data, error } = await updateBillingCourse(supabase, id, update);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { res } = await guard(supabase);
  if (res) return res;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await deleteBillingCourse(supabase, id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
