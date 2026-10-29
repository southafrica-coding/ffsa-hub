import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerIsAdmin } from "@/lib/auth/check-role-grant";
import { refuseSuperAdminTarget } from "@/lib/auth/super-admin-target";
import {
  MEMBERSHIP_ROLE_KEYS,
  setMembershipRole,
  type MembershipRoleKey,
} from "@/lib/users/set-membership-role";

// Sets a user's single "membership" role from the Users list (super admin or
// General Admin; only a super admin may change a super admin's). The role swap itself lives in setMembershipRole so the Leadership
// Track staff-decision flow can share it.

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await callerIsAdmin(supabase, authUser.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { user_id, role } = body as { user_id?: string; role?: MembershipRoleKey };
  if (!user_id || !role || !MEMBERSHIP_ROLE_KEYS.includes(role)) {
    return NextResponse.json(
      { error: "user_id and role (staff|student|community|none) are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const refused = await refuseSuperAdminTarget(supabase, authUser.id, admin, user_id);
  if (refused) return refused;

  await setMembershipRole(admin, user_id, role, authUser.id);

  return NextResponse.json({ success: true });
}
