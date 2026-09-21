import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { canEditEssenceStatement } from "@/lib/auth/check-cv-access";
import { updateEssenceStatement } from "@/services/staff-cv";

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

  const client = targetUserId === user.id ? supabase : createAdminClient();
  const { error } = await updateEssenceStatement(client, targetUserId, essenceStatement);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
