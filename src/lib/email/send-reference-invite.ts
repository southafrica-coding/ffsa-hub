import { referenceRequestEmailHtml } from "./templates/reference-request";
import { sendTransactional } from "./send-transactional";
import { resolveProgramEmail } from "./render-program-email";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Send a referee their reference-request invite for a given token. Shared by
 * the application-submission flow (initial invite) and the edit/swap flows
 * (re-invite after a corrected email), so the subject/from/link stay identical.
 *
 * When a programId is supplied, the school's per-program reference-request
 * override (on/off + subject + body) is applied; the "complete the reference"
 * button is always re-appended so a custom body never drops the link.
 */
export async function sendReferenceInvite(params: {
  toEmail: string;
  refereeName: string;
  applicantName: string;
  programName: string;
  slotLabel: string;
  token: string;
  programId?: string | null;
}) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ffsahub.com";
  const referenceUrl = `${siteUrl}/reference/${params.token}`;

  const defaults = {
    subject: `Reference Request — ${params.programName}`,
    html: referenceRequestEmailHtml({
      refereeName: params.refereeName,
      applicantName: params.applicantName,
      programName: params.programName,
      slotLabel: params.slotLabel,
      referenceUrl,
      siteUrl,
    }),
  };

  let subject = defaults.subject;
  let html = defaults.html;
  if (params.programId) {
    const resolved = await resolveProgramEmail(
      createAdminClient(),
      params.programId,
      "reference_request",
      defaults,
      {
        programName: params.programName,
        heading: "A reference is requested",
        cta: { label: "Complete the reference", url: referenceUrl },
        siteUrl,
      }
    );
    if (resolved.skip) {
      return { ok: false as const, error: "disabled", suppressed: false };
    }
    subject = resolved.subject;
    html = resolved.html;
  }

  return sendTransactional({
    to: params.toEmail,
    subject,
    html,
    category: "reference_request",
    sourceType: "reference_request",
  });
}
