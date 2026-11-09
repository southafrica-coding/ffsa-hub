import { referenceReminderEmailHtml } from "./templates/reference-reminder";
import { sendTransactional } from "./send-transactional";
import { resolveProgramEmail } from "./render-program-email";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  referenceReminderEmailText,
  resolveReferenceReplyTo,
} from "./reference-email";

/**
 * Nudge a referee who hasn't returned a reference. Same plain-text facts and
 * Reply-To as the invite. A program's custom subject is kept; otherwise the
 * subject stays "Reference Reminder — <Program>".
 */
export async function sendReferenceReminder(params: {
  toEmail: string;
  refereeName: string;
  applicantName: string;
  programName: string;
  slotLabel: string;
  token: string;
  programId?: string | null;
  referenceRequestId?: string | null;
}) {
  const admin = createAdminClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ffsahub.com";
  const referenceUrl = `${siteUrl}/reference/${params.token}`;
  const programName = params.programName || "School Program";

  const defaults = {
    subject: `Reference Reminder — ${programName}`,
    html: referenceReminderEmailHtml({
      refereeName: params.refereeName,
      applicantName: params.applicantName,
      programName,
      slotLabel: params.slotLabel,
      referenceUrl,
      siteUrl,
    }),
  };
  const text = referenceReminderEmailText({
    refereeName: params.refereeName,
    applicantName: params.applicantName,
    programName,
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
      "reference_reminder",
      defaults,
      {
        values: {
          program_name: programName,
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
    category: "reference_reminder",
    sourceType: "reference_request",
    sourceId: params.referenceRequestId ?? null,
    programDocuments: { programId: params.programId, emailType: "reference_reminder" },
  });
}
