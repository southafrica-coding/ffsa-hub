import { renderEmailShell, escapeHtml, bodyParagraph } from "../shell";

// Sent to an applicant when their prayer-room application is approved or denied.
// Two outcomes only.
export function prayerRoomDecisionEmailHtml({
  applicantFirstName,
  approved,
  note,
  siteUrl,
}: {
  applicantFirstName: string;
  approved: boolean;
  note?: string | null;
  siteUrl: string;
}): string {
  const noteHtml = note ? bodyParagraph(escapeHtml(note)) : "";

  if (approved) {
    return renderEmailShell({
      title: "Welcome to the prayer room team",
      preheader: "Your application was approved.",
      eyebrow: "Application Approved",
      heading: "Welcome to the team",
      bodyHtml: `
        ${bodyParagraph(`Hi ${escapeHtml(applicantFirstName)}, you're approved to serve in the prayer room. You can now be rostered into sets, accept invitations, and create and own your own devo sets.`)}
        ${noteHtml}
      `,
      cta: { label: "Open Prayer room", url: `${siteUrl}/prayer-room` },
      siteUrl,
    });
  }

  return renderEmailShell({
    title: "Application update",
    preheader: "An update on your prayer room application.",
    eyebrow: "Application Update",
    heading: "Thank you for applying",
    bodyHtml: `
      ${bodyParagraph(`Hi ${escapeHtml(applicantFirstName)}, thank you for your interest in serving in the prayer room. After review, we won't be moving forward at this time. You're welcome to apply again in the future.`)}
      ${noteHtml}
    `,
    siteUrl,
  });
}
