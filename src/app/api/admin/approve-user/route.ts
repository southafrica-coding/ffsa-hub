import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refuseSuperAdminTarget } from "@/lib/auth/super-admin-target";
import { activateApprovedUser, setApprovedJobTitle } from "@/services/users";
import { usersUpdateDeniedResponse } from "@/lib/users/users-update-error";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // super_admin or admin can approve users
  const { data: superCheck } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", authUser.id)
    .in("roles.name", ["super_admin", "admin"])
    .limit(1);

  if (!superCheck || superCheck.length === 0) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json();
  const { user_id, job_title } = body;

  if (!user_id) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  // status goes through the service role. job_title, when the body sends
  // one, is the only users column written with the admin's own client —
  // the single admin column in migration 315's GRANT (USER_ADMIN_CLIENT_COLUMNS).
  const admin = createAdminClient();

  // This also sets the job title, which on a super admin is theirs to change.
  const refused = await refuseSuperAdminTarget(supabase, authUser.id, admin, user_id);
  if (refused) return refused;
  const { data, error } = await activateApprovedUser(admin, user_id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (job_title !== undefined) {
    const { error: titleError } = await setApprovedJobTitle(supabase, user_id, job_title);
    if (titleError) {
      const denied = usersUpdateDeniedResponse(titleError);
      if (denied) return denied;
      return NextResponse.json({ error: titleError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true, user: data });
}
