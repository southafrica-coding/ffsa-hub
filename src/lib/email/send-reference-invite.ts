import { referenceRequestEmailHtml } from "./templates/reference-request";
import { sendTransactional } from "./send-transactional";
import { resolveProgramEmail } from "./render-program-email";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  referenceInviteSubject,
  referenceRequestEmailText,
  resolveReferenceReplyTo,
} from "./reference-email";

/**
 * Send a referee their reference-request invite for a given token. Shared by
 * the application-submission flow (initial invite) and the edit/swap flows
 * (re-invite after a corrected email), so the subject/from/link stay identical.
 *
 * When a programId is supplied, the school's per-program reference-request
 * override (on/off + subject + body) is applied. A custom subject is kept.
 * When the school has not set one, the subject is
 * "<Applicant> asked you to give a reference for <Program>".
 * The plain-text part always carries who asked, the program, the link, and
 * what a reference involves. Reply-To is the training inbox when one is
 * configured.
 *
 * Callers should stamp email_sent_at only when the result is
 * referenceSendConfirmed (a real provider message id).
 */
export async function sendReferenceInvite(params: {
  toEmail: string;
  refereeName: string;
  applicantName: string;
  programName: string;
  slotLabel: string;
  token: string;
  programId?: string | null;
  /** Ledger link so a later bounce can be tied to this reference. */
  referenceRequestId?: string | null;
}) {
  const admin = createAdminClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ffsahub.com";
  const referenceUrl = `${siteUrl}/reference/${params.token}`;

  const defaults = {
    subject: referenceInviteSubject(params.applicantName, params.programName),
    html: referenceRequestEmailHtml({
      refereeName: params.refereeName,
      applicantName: params.applicantName,
      programName: params.programName,
      slotLabel: params.slotLabel,
      referenceUrl,
      siteUrl,
    }),
  };
  const text = referenceRequestEmailText({
    refereeName: params.refereeName,
    applicantName: params.applicantName,
    programName: params.programName,
    slotLabel: params.slotLabel,
    referenceUrl,
  });

  const replyToPromise = resolveReferenceReplyTo(admin);

  let subject = defaults.subject;
  let html = defaults.html;
  if (params.programId) {
    const resolved = await resolveProgramEmail(
      admin,
      params.programId,
      "reference_request",
      defaults,
      {
        values: {
          program_name: params.programName,
          applicant_name: params.applicantName,
          referee_name: params.refereeName,
          reference_type: params.slotLabel,
        },
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

  const replyTo = await replyToPromise;

  return sendTransactional({
    to: params.toEmail,
    subject,
    html,
    text,
    replyTo,
    category: "reference_request",
    sourceType: "reference_request",
    sourceId: params.referenceRequestId ?? null,
    programDocuments: { programId: params.programId, emailType: "reference_request" },
  });
}
