import { referenceRequestEmailHtml } from "./templates/reference-request";
import { sendTransactional } from "./send-transactional";

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
  const referenceUrl = `${siteUrl}/reference/${params.token}`;

  return sendTransactional({
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
    category: "reference_request",
    sourceType: "reference_request",
  });
}
