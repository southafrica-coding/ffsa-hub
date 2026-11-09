import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refuseSuperAdminTarget } from "@/lib/auth/super-admin-target";
import { activateApprovedUser } from "@/services/users";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // is_admin() is has_any_role(['super_admin','admin']) with scope_type IS NULL.
  // A scoped admin does not pass. A throw or an error fails closed, before
  // any service-role write.
  let unscopedAdmin = false;
  try {
    const { data, error } = await supabase.rpc("is_admin");
    if (!error && data === true) unscopedAdmin = true;
  } catch {
    unscopedAdmin = false;
  }
  if (!unscopedAdmin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json();
  const { user_id, job_title } = body;

  if (!user_id) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // This also sets the job title, which on a super admin is theirs to change.
  const refused = await refuseSuperAdminTarget(supabase, authUser.id, admin, user_id);
  if (refused) return refused;

  // status and job_title go out in one service-role UPDATE. Two statements
  // could approve the account and then fail the title, returning an error
  // for a user who is already active. One statement applies both or neither.
  const { data, error } = await activateApprovedUser(admin, user_id, job_title);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, user: data });
}
