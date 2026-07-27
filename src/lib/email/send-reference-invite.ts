import { Resend } from "resend";
import { referenceRequestEmailHtml } from "./templates/reference-request";

const resend = new Resend(process.env.RESEND_API_KEY?.trim());

/**
 * Send a referee their reference-request invite for a given token. Shared by
 * the application-submission flow (initial invite) and the edit/swap flows
 * (re-invite after a corrected email), so the subject/from/link stay identical.
 */
export async function sendReferenceInvite(params: {
  toEmail: string;
  refereeName: string;
  applicantName: string;
  programName: string;
  slotLabel: string;
  token: string;
}) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ffsahub.com";
  const fromEmail = (process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com").trim();
  const referenceUrl = `${siteUrl}/reference/${params.token}`;

  return resend.emails.send({
    from: `Fire & Fragrance SA <${fromEmail}>`,
    to: params.toEmail,
    subject: `Reference Request — ${params.programName}`,
    html: referenceRequestEmailHtml({
      refereeName: params.refereeName,
      applicantName: params.applicantName,
      programName: params.programName,
      slotLabel: params.slotLabel,
      referenceUrl,
      siteUrl,
    }),
  });
}
