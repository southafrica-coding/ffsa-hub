import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageProgramStaff } from "@/lib/schools/program-staff-access";
import {
  listProgramStaff,
  switchPersonToProgramStaff,
} from "@/services/program-staff";

// POST /api/schools/programs/[programId]/staff/switch  { userId }
//
// Idempotent. Makes this person staff of this program, then removes their
// leader row and their schools.* permissions scoped to this program.
// Global grants and other programs stay. See docs/program-staff.md.

export async function POST(
  request: Request,
  context: { params: Promise<{ programId: string }> }
) {
  const { programId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await userCanManageProgramStaff(supabase, user.id, programId))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { userId } = (await request.json().catch(() => ({}))) as { userId?: string };
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await switchPersonToProgramStaff(
    admin,
    programId,
    userId,
    user.id
  );
  if (error) {
    const status = error.message === "Refusing to switch a super admin" ? 400 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  const { data: staff } = await listProgramStaff(admin, programId);
  return NextResponse.json({ staff: staff ?? [], switch: data });
}
