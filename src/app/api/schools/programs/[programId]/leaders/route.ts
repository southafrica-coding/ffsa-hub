import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import {
  listProgramLeaders,
  addProgramLeader,
  removeProgramLeader,
} from "@/services/program-leaders";
import {
  ensureSchoolLeaderRole,
  revokeSchoolLeaderRoleIfOrphaned,
} from "@/lib/schools/school-leader-role";

// POST   /api/schools/programs/[programId]/leaders   { userId }  → add
// DELETE /api/schools/programs/[programId]/leaders   { userId }  → remove
//
// Managing a school's leader team. Gated on program-scoped access, so
// admins, global schools managers, AND existing leaders of this program
// can grow or prune the team (a school led by a team can add its own
// members). RLS enforces the same rule as defense-in-depth.
//
// Each add / remove also syncs the school_leader role (migration 292), which
// is what lets school leaders request space bookings: granted on add if
// missing, revoked on remove only when they lead no other program.

async function authorize(programId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated", status: 401 as const };
  if (!(await userCanManageProgram(supabase, user.id, programId))) {
    return { error: "Not authorized", status: 403 as const };
  }
  return { user };
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

  const { userId } = (await request.json().catch(() => ({}))) as {
    userId?: string;
  };
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await addProgramLeader(admin, programId, userId, auth.user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await ensureSchoolLeaderRole(admin, userId, auth.user.id);

  const { data: leaders } = await listProgramLeaders(admin, programId);
  return NextResponse.json({ leaders: leaders ?? [] });
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

  const { userId } = (await request.json().catch(() => ({}))) as {
    userId?: string;
  };
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await removeProgramLeader(admin, programId, userId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await revokeSchoolLeaderRoleIfOrphaned(admin, userId);

  const { data: leaders } = await listProgramLeaders(admin, programId);
  return NextResponse.json({ leaders: leaders ?? [] });
}
