import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { userCanReadApplication, APPLICATIONS_EXPIRED_MESSAGE } from "@/lib/auth/application-expiry";
import { unassignableContactError } from "@/lib/auth/assignable-contacts";
import { sendStaffAssignmentEmails } from "@/lib/email/send-staff-assignment";
import { syncEnrollmentFromApplication } from "@/lib/schools/staff-assignment-sync";

// Assigns (or clears) the point-of-contact staff member for an application
// response. Fires notification emails to both parties when the assignee
// actually changes, and resets the staff_viewed_at flag so the new assignee's
// dashboard shows an unread badge. Walking with on the same person's
// enrolment in this school follows (see staff-assignment-sync).
export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { response_id, assigned_staff_id } = body as {
    response_id?: string;
    assigned_staff_id?: string | null;
  };

  if (!response_id) {
    return NextResponse.json({ error: "response_id is required" }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  const { data: existing, error: fetchError } = await adminSupabase
    .from("application_responses")
    .select(
      "id, program_id, user_id, applicant_email, applicant_info, assigned_staff_id, users!application_responses_user_id_fkey(first_name, last_name, preferred_name, email), programs(name)"
    )
    .eq("id", response_id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  // Authorize against THIS application's program: global schools managers, or a
  // user scoped specifically to this program.
  const responseProgramId = (existing as unknown as { program_id: string }).program_id;
  if (!(await userCanManageProgram(supabase, authUser.id, responseProgramId))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  // RLS-backed: the 6-month expiry lock (migration 223).
  if (!(await userCanReadApplication(supabase, response_id))) {
    return NextResponse.json({ error: APPLICATIONS_EXPIRED_MESSAGE }, { status: 403 });
  }

  const previousStaffId = (existing as unknown as { assigned_staff_id: string | null }).assigned_staff_id;
  const newStaffId = assigned_staff_id ?? null;
  const changed = previousStaffId !== newStaffId;

  // Same eligibility as the Applicants dropdown: program-scoped
  // assignable-contact grants, super admins, active leaders, and active
  // program staff of this program. Clearing the assignment stays open.
  const rejection = await unassignableContactError(
    adminSupabase,
    responseProgramId,
    newStaffId
  );
  if (rejection) {
    return NextResponse.json({ error: rejection }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    assigned_staff_id: newStaffId,
    staff_assigned_at: newStaffId ? new Date().toISOString() : null,
    staff_assigned_by: newStaffId ? authUser.id : null,
    // Reset the viewed flag whenever the assignee changes so the new
    // person sees it as unread.
    staff_viewed_at: null,
  };

  const { error: updateError } = await adminSupabase
    .from("application_responses")
    .update(updates)
    .eq("id", response_id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Audit
  await adminSupabase.from("audit_logs").insert({
    user_id: authUser.id,
    action: "assign_application_staff",
    resource_type: "application_responses",
    resource_id: response_id,
    changes: {
      previous_staff_id: previousStaffId,
      new_staff_id: newStaffId,
    },
  });

  // Keep Walking with in step. The enrolment route only requires
  // userCanManageProgram on this same program, checked above.
  const sync = await syncEnrollmentFromApplication(adminSupabase, {
    userId: (existing as unknown as { user_id: string | null }).user_id,
    programId: responseProgramId,
    previousStaffId,
    newStaffId,
    actorId: authUser.id,
    canWriteEnrollment: true,
  });

  // Notifications (only when the assignee actually changed and we have a new
  // staff member). If Walking with already held this person, they and the
  // student were told then, so one email is enough.
  if (changed && newStaffId && sync.outcome !== "same") {
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

    const applicantInfo = (existing as unknown as { applicant_info: Record<string, string> | null }).applicant_info;
    const applicantEmail =
      (existing as unknown as { applicant_email: string | null }).applicant_email ?? applicantInfo?.email ?? null;

    const student = {
      email: studentUser?.email ?? applicantEmail,
      first_name: studentUser?.first_name ?? applicantInfo?.first_name ?? null,
      last_name: studentUser?.last_name ?? applicantInfo?.last_name ?? null,
      preferred_name: studentUser?.preferred_name ?? null,
    };

    const programName =
      (existing as unknown as { programs: { name: string } | null }).programs?.name ?? "School Program";

    if (staffUser) {
      await sendStaffAssignmentEmails({
        stage: "application",
        programName,
        student,
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
