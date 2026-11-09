import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageProgramStaff } from "@/lib/schools/program-staff-access";
import {
  addProgramStaff,
  listProgramStaff,
  removeProgramStaff,
} from "@/services/program-staff";

// GET    /api/schools/programs/[programId]/staff
// POST   /api/schools/programs/[programId]/staff   { userId }
// DELETE /api/schools/programs/[programId]/staff   { userId }
//
// Gated on has_schools_access: admins, schools.manage, and this school's
// leaders. Staff cannot add or remove staff. RLS repeats the same rule.

async function authorize(programId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", status: 401 as const };
  if (!(await userCanManageProgramStaff(supabase, user.id, programId))) {
    return { error: "Not authorized", status: 403 as const };
  }
  return { user };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ programId: string }> }
) {
  const { programId } = await context.params;
  const auth = await authorize(programId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const admin = createAdminClient();
  const { data, error } = await listProgramStaff(admin, programId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ staff: data ?? [] });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ programId: string }> }
) {
  const { programId } = await context.params;
  const auth = await authorize(programId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { userId } = (await request.json().catch(() => ({}))) as { userId?: string };
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await addProgramStaff(admin, programId, userId, auth.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: staff } = await listProgramStaff(admin, programId);
  return NextResponse.json({ staff: staff ?? [] });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ programId: string }> }
) {
  const { programId } = await context.params;
  const auth = await authorize(programId);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { userId } = (await request.json().catch(() => ({}))) as { userId?: string };
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await removeProgramStaff(admin, programId, userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: staff } = await listProgramStaff(admin, programId);
  return NextResponse.json({ staff: staff ?? [] });
}
