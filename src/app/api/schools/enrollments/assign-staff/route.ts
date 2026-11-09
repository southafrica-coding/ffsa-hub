import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { unassignableContactError } from "@/lib/auth/assignable-contacts";
import { sendStaffAssignmentEmails } from "@/lib/email/send-staff-assignment";

// Assigns (or clears) the point-of-contact staff member for an enrollment.
// Intentionally independent of the application-stage assignment — a staff
// member does NOT automatically follow an applicant when they're enrolled.
export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { enrollment_id, assigned_staff_id } = body as {
    enrollment_id?: string;
    assigned_staff_id?: string | null;
  };

  if (!enrollment_id) {
    return NextResponse.json({ error: "enrollment_id is required" }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  const { data: existing, error: fetchError } = await adminSupabase
    .from("enrollments")
    .select(
      "id, program_id, user_id, assigned_staff_id, users!enrollments_user_id_fkey(first_name, last_name, preferred_name, email), programs(name)"
    )
    .eq("id", enrollment_id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Enrollment not found" }, { status: 404 });
  }

  // Authorize against THIS enrollment's program: global schools managers, or a
  // user scoped specifically to this program.
  const enrollmentProgramId = (existing as unknown as { program_id: string }).program_id;
  if (!(await userCanManageProgram(supabase, authUser.id, enrollmentProgramId))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const previousStaffId = (existing as unknown as { assigned_staff_id: string | null }).assigned_staff_id;
  const newStaffId = assigned_staff_id ?? null;
  const changed = previousStaffId !== newStaffId;

  // Same eligibility as the roster picker: program-scoped assignable-contact
  // grants, super admins, and active leaders of this program.
  const rejection = await unassignableContactError(
    adminSupabase,
    enrollmentProgramId,
    newStaffId
  );
  if (rejection) {
    return NextResponse.json({ error: rejection }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    assigned_staff_id: newStaffId,
    staff_assigned_at: newStaffId ? new Date().toISOString() : null,
    staff_assigned_by: newStaffId ? authUser.id : null,
    staff_viewed_at: null,
  };

  const { error: updateError } = await adminSupabase
    .from("enrollments")
    .update(updates)
    .eq("id", enrollment_id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await adminSupabase.from("audit_logs").insert({
    user_id: authUser.id,
    action: "assign_enrollment_staff",
    resource_type: "enrollments",
    resource_id: enrollment_id,
    changes: {
      previous_staff_id: previousStaffId,
      new_staff_id: newStaffId,
    },
  });

  if (changed && newStaffId) {
    const { data: staffUser } = await adminSupabase
      .from("users")
      .select("id, first_name, last_name, preferred_name, email")
      .eq("id", newStaffId)
      .single();

    const { data: assignedBy } = await adminSupabase
      .from("users")
      .select("first_name, last_name, preferred_name")
      .eq("id", authUser.id)
      .maybeSingle();

    const studentUser = (existing as unknown as {
      users: { first_name: string | null; last_name: string | null; preferred_name: string | null; email: string | null } | null;
    }).users;

    const programName =
      (existing as unknown as { programs: { name: string } | null }).programs?.name ?? "School Program";

    if (staffUser && studentUser) {
      await sendStaffAssignmentEmails({
        stage: "enrollment",
        programName,
        student: {
          email: studentUser.email,
          first_name: studentUser.first_name,
          last_name: studentUser.last_name,
          preferred_name: studentUser.preferred_name,
        },
        staff: {
          email: staffUser.email,
          first_name: staffUser.first_name,
          last_name: staffUser.last_name,
          preferred_name: staffUser.preferred_name,
        },
        assignedBy: assignedBy ?? null,
      });
    }
  }

  return NextResponse.json({ success: true });
}
