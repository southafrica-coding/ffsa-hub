import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canUseStaffDecisions } from "@/lib/auth/check-okr-access";
import { setMembershipRole } from "@/lib/users/set-membership-role";
import { validateDepartment } from "@/lib/users/validate-department";
import { LEADERSHIP_TEAM_SLUG, onlyAdminDepartmentMessage } from "@/lib/users/self-department";

// POST /api/schools/staff-decisions/make-staff — after a recorded "yes",
// switch the student's membership role to Staff and (optionally) set their
// department. Leadership Team only, and only for a "yes" on file: this is
// the one place a non-admin can make someone staff.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await canUseStaffDecisions(supabase, user.id))) {
    return NextResponse.json({ error: "Only the Leadership Team can do this." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { enrollment_id, department } = body as {
    enrollment_id?: string;
    department?: string | null;
  };
  if (!enrollment_id) {
    return NextResponse.json({ error: "enrollment_id is required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new table isn't in the generated types yet
  const admin: any = createAdminClient();
  const { data: decision } = await admin
    .from("staff_acceptance_decisions")
    .select("accepted, user_id")
    .eq("enrollment_id", enrollment_id)
    .maybeSingle();
  if (!decision?.accepted) {
    return NextResponse.json(
      { error: "Record a “yes” first — only accepted students can be made staff here." },
      { status: 400 }
    );
  }
  if (!decision.user_id) {
    return NextResponse.json(
      { error: "This person no longer has a Hub account." },
      { status: 400 }
    );
  }

  const dept = typeof department === "string" ? department.trim() : "";
  // leadership_team grants the unscoped leadership_team role. Only an admin
  // sets it, through PATCH /api/users/[id] on the service role. This route
  // is Leadership Team, not is_admin().
  if (dept === LEADERSHIP_TEAM_SLUG) {
    return NextResponse.json(
      { error: onlyAdminDepartmentMessage(dept) },
      { status: 403 }
    );
  }
  if (dept) {
    const departmentError = await validateDepartment(admin, dept);
    if (departmentError) {
      return NextResponse.json({ error: departmentError }, { status: 400 });
    }
  }

  await setMembershipRole(admin, decision.user_id, "staff", user.id);
  if (dept) {
    const { error } = await admin
      .from("users")
      .update({ department: dept })
      .eq("id", decision.user_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
