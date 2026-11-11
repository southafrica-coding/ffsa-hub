import { renderEmailShell, escapeHtml, bodyParagraph } from "../shell";

// Confirmation to an applicant that their prayer-room application was received.
export function prayerRoomApplicationReceivedEmailHtml({
  applicantFirstName,
  siteUrl,
}: {
  applicantFirstName: string;
  siteUrl: string;
}): string {
  return renderEmailShell({
    title: "Application received",
    preheader: "We've received your prayer room application.",
    eyebrow: "Prayer room",
    heading: "We've got your application",
    bodyHtml: `
      ${bodyParagraph(`Hi ${escapeHtml(applicantFirstName)}, thanks for applying to serve in the prayer room.`)}
      ${bodyParagraph("A coordinator will assign you to an evaluator, who'll reach out to meet with you. You'll hear from us once a decision is made.")}
    `,
    cta: { label: "View Status", url: `${siteUrl}/prayer-room` },
    siteUrl,
  });
}
