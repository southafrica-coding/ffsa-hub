import { randomUUID } from "crypto";
import { updateReferenceRequest } from "@/services/schools";
import { sendReferenceInvite } from "@/lib/email/send-reference-invite";
import { referenceSendConfirmed } from "@/lib/email/reference-email";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The reference row shape this helper needs. Both callers load it with the same
// joined select (see REFERENCE_EDIT_SELECT) so applicant/program/slot names are
// available for the re-invite email.
export const REFERENCE_EDIT_SELECT =
  "*, reference_slots(label), application_responses(status_token, program_id, applicant_info, programs(name), users!application_responses_user_id_fkey(first_name, last_name))";

type EditResult =
  | { ok: true; data: unknown; emailed: boolean; emailChanged: boolean }
  | { ok: false; status: number; error: string };

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
 * Apply a referee name/email correction to a pending reference request.
 *
 * Rules (shared by the admin and applicant-status paths):
 *  - Only pending references can be edited; submitted ones are locked.
 *  - When the email changes, the token is regenerated (the old invite link
 *    stops working) and a fresh invite is sent to the corrected address.
 *  - A name-only change just updates the name — no token churn, no resend.
 *
 * Authorization is the caller's responsibility; this runs against the admin
 * (service-role) client so callers MUST gate access before invoking it.
 */
export async function editReferenceContact(
  adminSupabase: Client,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ref: any,
  input: { referee_name?: unknown; referee_email?: unknown }
): Promise<EditResult> {
  if (!ref) return { ok: false, status: 404, error: "Reference request not found" };
  if (ref.status === "submitted") {
    return {
      ok: false,
      status: 409,
      error: "This reference has already been submitted and can no longer be changed.",
    };
  }

  const name =
    typeof input.referee_name === "string" ? input.referee_name.trim() : ref.referee_name;
  const email =
    typeof input.referee_email === "string"
      ? input.referee_email.trim()
      : ref.referee_email;

  if (!name) return { ok: false, status: 400, error: "A reference name is required." };
  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, status: 400, error: "A valid reference email is required." };
  }

  const emailChanged =
    email.toLowerCase() !== String(ref.referee_email ?? "").toLowerCase();

  const payload: {
    referee_name: string;
    referee_email: string;
    token?: string;
    email_sent_at?: string | null;
    reminder_sent_at?: string | null;
  } = { referee_name: name, referee_email: email };

  let token: string = ref.token;
  if (emailChanged) {
    token = randomUUID();
    payload.token = token;
    // Cleared until the provider confirms a message id. A previous stamp
    // belonged to the old address.
    payload.email_sent_at = null;
    payload.reminder_sent_at = null;
  }

  const { data, error } = await updateReferenceRequest(adminSupabase, ref.id, payload);
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) {
    // The status guard in updateReferenceRequest rejected it (raced to submitted).
    return {
      ok: false,
      status: 409,
      error: "This reference can no longer be changed.",
    };
  }

  let emailed = false;
  if (emailChanged) {
    const app = ref.application_responses;
    try {
      const sent = await sendReferenceInvite({
        toEmail: email,
        refereeName: name,
        applicantName: resolveApplicantName(app),
        programName: app?.programs?.name ?? "School Program",
        slotLabel: ref.reference_slots?.label ?? "Reference",
        token,
        programId: app?.program_id ?? null,
        referenceRequestId: ref.id,
      });
      // A result with no provider id (or ok: false) is not a send. Don't
      // throw — the corrected details are already saved.
      if (referenceSendConfirmed(sent)) {
        emailed = true;
        await adminSupabase
          .from("reference_requests")
          .update({ email_sent_at: new Date().toISOString() })
          .eq("id", ref.id);
      }
    } catch {
      emailed = false;
    }
  }

  return { ok: true, data, emailed, emailChanged };
}
