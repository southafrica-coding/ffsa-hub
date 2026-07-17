import { renderEmailShell, escapeHtml, bodyParagraph, emphasis } from "../shell";

// Sent once every required reference for an application has been submitted.
// Two flavours:
//   - assigned  → to the assigned staff member ("ready for review").
//   - unassigned → to the program's leader(s) ("no one assigned — please assign").
export function referencesCompleteEmailHtml({
  staffFirstName,
  applicantName,
  programName,
  programId,
  siteUrl,
  unassigned = false,
}: {
  staffFirstName: string;
  applicantName: string;
  programName: string;
  programId: string;
  siteUrl: string;
  unassigned?: boolean;
}): string {
  const programUrl = `${siteUrl.replace(/\/$/, "")}/schools/${programId}`;
  const intro = bodyParagraph(
    `Hi ${escapeHtml(staffFirstName)}, all references for ${emphasis(escapeHtml(applicantName))} in ${emphasis(escapeHtml(programName))} have now been submitted.`
  );

  if (unassigned) {
    return renderEmailShell({
      title: "References Complete",
      preheader: `All references are in for ${applicantName} — needs assigning.`,
      eyebrow: "References Complete",
      heading: "An application needs assigning",
      bodyHtml: `
        ${intro}
        ${bodyParagraph(`This application doesn't have a staff member assigned yet. As a program leader, please review it and assign someone to take it forward.`)}
      `,
      cta: { label: "Open Program", url: programUrl },
      siteUrl,
    });
  }

  return renderEmailShell({
    title: "References Complete",
    preheader: `All references are in for ${applicantName}.`,
    eyebrow: "References Complete",
    heading: "An application is ready for review",
    bodyHtml: `
      ${intro}
      ${bodyParagraph(`This application is assigned to you and is ready for the next step.`)}
    `,
    cta: { label: "Open Application", url: programUrl },
    siteUrl,
  });
}
