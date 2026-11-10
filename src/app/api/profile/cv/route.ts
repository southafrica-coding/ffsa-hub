import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { canEditEssenceStatement } from "@/lib/auth/check-cv-access";
import { updateEssenceStatement } from "@/services/staff-cv";
import { rejectIfDeactivated } from "@/lib/users/self-edit-guard";
import { usersUpdateDeniedResponse } from "@/lib/users/users-update-error";

// PATCH /api/profile/cv — update a staff member's essence statement.
// Self, or admin editing on behalf (body.userId).
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const targetUserId = typeof body.userId === "string" ? body.userId : user.id;
  const essenceStatement = typeof body.essence_statement === "string" ? body.essence_statement : "";

  if (!(await canEditEssenceStatement(supabase, user.id, targetUserId))) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const self = targetUserId === user.id;
  if (self) {
    const blocked = await rejectIfDeactivated(supabase, user.id);
    if (blocked) return blocked;
  }

  const client = self ? supabase : createAdminClient();
  const { error } = await updateEssenceStatement(client, targetUserId, essenceStatement);
  if (error) {
    const denied = self ? usersUpdateDeniedResponse(error) : null;
    if (denied) return denied;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
