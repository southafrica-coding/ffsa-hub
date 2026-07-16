import { sendReferencesCompleteEmail } from "@/lib/email/send-references-complete";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

function resolveApplicantName(app: any): string {
  const fromUser = app?.users
    ? [app.users.first_name, app.users.last_name].filter(Boolean).join(" ")
    : "";
  const fromInfo = app?.applicant_info
    ? [app.applicant_info.first_name, app.applicant_info.last_name]
        .filter(Boolean)
        .join(" ")
    : "";
  return fromUser || fromInfo || "the applicant";
}

/**
 * After a reference is submitted, notify the application's assigned staff member
 * IF every required reference is now in.
 *
 * - "Complete" = all reference slots marked `is_required` for this application
 *   have `status = 'submitted'`. Optional-slot references don't gate it.
 * - Fires at most once naturally: only the final required submission flips the
 *   set to complete, and a submitted reference can't be re-opened.
 * - Unassigned applications (`assigned_staff_id` null) send NO email — by design.
 *
 * Runs against the admin (service-role) client — the referee is unauthenticated.
 * Fully self-contained try/catch: a notification problem never fails the caller.
 */
export async function maybeNotifyReferencesComplete(
  adminSupabase: Client,
  applicationId: string
): Promise<void> {
  try {
    const { data: refs } = await adminSupabase
      .from("reference_requests")
      .select("status, reference_slots!inner(is_required)")
      .eq("application_id", applicationId);

    const required = ((refs ?? []) as any[]).filter(
      (r) => r.reference_slots?.is_required
    );
    const complete =
      required.length > 0 && required.every((r) => r.status === "submitted");
    if (!complete) return;

    const { data: app } = await adminSupabase
      .from("application_responses")
      .select(
        "id, program_id, applicant_email, applicant_info, " +
          "users!application_responses_user_id_fkey(first_name, last_name, preferred_name, email), " +
          "assigned_staff:users!application_responses_assigned_staff_id_fkey(first_name, last_name, preferred_name, email), " +
          "programs(name)"
      )
      .eq("id", applicationId)
      .single();

    const assignedStaff = (app as any)?.assigned_staff;
    if (!assignedStaff) return; // Unassigned — no notification (deferred feature).

    await sendReferencesCompleteEmail({
      staff: assignedStaff,
      applicantName: resolveApplicantName(app),
      programName: (app as any)?.programs?.name ?? "School Program",
      programId: (app as any)?.program_id,
    });
  } catch {
    // Never let a notification failure surface to the referee's submission.
    console.error("maybeNotifyReferencesComplete failed", { applicationId });
  }
}
