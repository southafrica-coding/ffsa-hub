import { Resend } from "resend";
import { referenceRequestApplicantEmailHtml } from "./templates/reference-request-applicant";

const resend = new Resend(process.env.RESEND_API_KEY?.trim());

/**
 * Email an applicant asking them to add the required references they didn't
 * provide when they submitted. Links to their application-status page, where
 * the "Add your references" section lets them enter each referee. Shared by the
 * per-applicant and bulk admin actions so the subject/from/link stay identical.
 */
export async function sendApplicantReferenceRequest(params: {
  toEmail: string;
  firstName: string;
  programName: string;
  missingLabels: string[];
  statusToken: string;
}) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ffsahub.com";
  const fromEmail = (process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com").trim();
  const statusUrl = `${siteUrl}/apply/status/${params.statusToken}`;

  return resend.emails.send({
    from: `Fire & Fragrance SA <${fromEmail}>`,
    to: params.toEmail,
    subject: `Action needed: references for ${params.programName}`,
    html: referenceRequestApplicantEmailHtml({
      firstName: params.firstName,
      programName: params.programName,
      missingLabels: params.missingLabels,
      statusUrl,
      siteUrl,
    }),
  });
}
