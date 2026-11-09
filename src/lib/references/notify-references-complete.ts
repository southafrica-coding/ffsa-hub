import { sendReferencesCompleteEmail } from "@/lib/email/send-references-complete";
import { requiredReferencesComplete } from "@/lib/schools/applicant-pipeline-stage";

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

type Recipient = {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  preferred_name?: string | null;
};

// Active users who hold the `program_leader` role for this program — i.e.
// assigned to it (scope_type='program', scope_id=<program>) OR globally
// (scope_type NULL, applies everywhere), mirroring has_schools_access. Deduped
// by email. Used as the fallback recipient when an application is unassigned.
async function getProgramLeaders(
  adminSupabase: Client,
  programId: string
): Promise<Recipient[]> {
  const { data } = await adminSupabase
    .from("user_roles")
    .select(
      "scope_type, scope_id, roles!inner(name), " +
        "user:users!user_id(first_name, last_name, preferred_name, email, status)"
    )
    .eq("roles.name", "program_leader");

  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const row of ((data ?? []) as any[])) {
    const applies =
      row.scope_type == null ||
      (row.scope_type === "program" && row.scope_id === programId);
    if (!applies) continue;
    const u = row.user;
    if (!u?.email || u.status !== "active") continue;
    if (seen.has(u.email)) continue;
    seen.add(u.email);
    out.push(u);
  }
  return out;
}

/**
 * After a reference is submitted, notify the application's assigned staff member
 * IF every required reference is now in.
 *
 * - "Complete" is requiredReferencesComplete: every required slot has a
 *   submitted request. A required slot with no request row is not complete.
 *   Optional slots do not count. The stage advance uses the same helper.
 * - Fires at most once naturally: only the final required submission flips the
 *   set to complete, and a submitted reference can't be re-opened.
 * - Assigned → emails the assignee. Unassigned → emails the program's
 *   leader(s) a "needs assigning" variant (nothing sent if there are none).
 *
 * Runs against the admin (service-role) client — the referee is unauthenticated.
 * Fully self-contained try/catch: a notification problem never fails the caller.
 */
export async function maybeNotifyReferencesComplete(
  adminSupabase: Client,
  applicationId: string
): Promise<void> {
  try {
    const { data: head, error: headError } = await adminSupabase
      .from("application_responses")
      .select("program_id")
      .eq("id", applicationId)
      .maybeSingle();
    if (headError || !head?.program_id) return;

    const [{ data: slots, error: slotError }, { data: refs, error: refError }] =
      await Promise.all([
        adminSupabase
          .from("reference_slots")
          .select("id, is_required")
          .eq("program_id", head.program_id),
        adminSupabase
          .from("reference_requests")
          .select("slot_id, status")
          .eq("application_id", applicationId),
      ]);
    if (slotError || refError) return;

    const requiredSlotIds = (
      (slots ?? []) as Array<{ id: string; is_required: boolean }>
    )
      .filter((slot) => slot.is_required)
      .map((slot) => slot.id);
    const complete = requiredReferencesComplete(
      requiredSlotIds,
      ((refs ?? []) as Array<{ slot_id: string; status: string }>).map((row) => ({
        slotId: row.slot_id,
        status: row.status,
      }))
    );
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

    const applicantName = resolveApplicantName(app);
    const programName = (app as any)?.programs?.name ?? "School Program";
    const programId = (app as any)?.program_id;

    const assignedStaff = (app as any)?.assigned_staff;
    if (assignedStaff) {
      await sendReferencesCompleteEmail({
        staff: assignedStaff,
        applicantName,
        programName,
        programId,
      });
      return;
    }

    // Unassigned → notify the program's leader(s) so they can assign it.
    const leaders = await getProgramLeaders(adminSupabase, programId);
    for (const leader of leaders) {
      await sendReferencesCompleteEmail({
        staff: leader,
        applicantName,
        programName,
        programId,
        unassigned: true,
      });
    }
  } catch {
    // Never let a notification failure surface to the referee's submission.
    console.error("maybeNotifyReferencesComplete failed", { applicationId });
  }
}
