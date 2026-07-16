import { renderEmailShell, escapeHtml, bodyParagraph, emphasis } from "../shell";

// Sent to the staff member an application is assigned to, once every required
// reference for that application has been submitted — the application is ready
// for their review.
export function referencesCompleteEmailHtml({
  staffFirstName,
  applicantName,
  programName,
  programId,
  siteUrl,
}: {
  staffFirstName: string;
  applicantName: string;
  programName: string;
  programId: string;
  siteUrl: string;
}): string {
  const programUrl = `${siteUrl.replace(/\/$/, "")}/schools/${programId}`;

  return renderEmailShell({
    title: "References Complete",
    preheader: `All references are in for ${applicantName}.`,
    eyebrow: "References Complete",
    heading: "An application is ready for review",
    bodyHtml: `
      ${bodyParagraph(`Hi ${escapeHtml(staffFirstName)}, all references for ${emphasis(escapeHtml(applicantName))} in ${emphasis(escapeHtml(programName))} have now been submitted.`)}
      ${bodyParagraph(`This application is assigned to you and is ready for the next step.`)}
    `,
    cta: { label: "Open Application", url: programUrl },
    siteUrl,
  });
}
