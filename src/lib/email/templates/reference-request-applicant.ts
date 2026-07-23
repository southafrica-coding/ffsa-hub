import { renderEmailShell, escapeHtml, bodyParagraph, emphasis } from "../shell";

/**
 * Emailed to an APPLICANT whose submitted application is missing one or more
 * required references (they left the referee fields blank at submit time). The
 * CTA takes them to their own application-status page, where they can now add
 * their referees — who then receive the standard reference-request invite.
 */
export function referenceRequestApplicantEmailHtml({
  firstName,
  programName,
  missingLabels,
  statusUrl,
  siteUrl,
}: {
  firstName: string;
  programName: string;
  missingLabels: string[];
  statusUrl: string;
  siteUrl?: string | null;
}): string {
  const labelList =
    missingLabels.length > 0
      ? missingLabels.map((l) => emphasis(escapeHtml(l))).join(", ")
      : emphasis("your references");

  return renderEmailShell({
    title: "Action needed: references",
    preheader: `Your application to ${programName} is missing required references.`,
    eyebrow: "Action Needed",
    heading: `Hi ${escapeHtml(firstName)}`,
    bodyHtml: `
      ${bodyParagraph(`Thanks for applying to ${emphasis(escapeHtml(programName))}. Your application is complete except for one thing: we still need the details of ${labelList}.`)}
      ${bodyParagraph("Click the button below to add your reference(s). Once you enter each reference's name and email, we'll send them a short form to complete on your behalf.")}
      <p style="margin:24px 0 0;font-size:13px;color:#5a4e42;line-height:1.5;">
        If the button doesn't work, copy and paste this link into your browser:<br/>
        <a href="${escapeHtml(statusUrl)}" style="color:#F5C518;word-break:break-all;">${escapeHtml(statusUrl)}</a>
      </p>
    `,
    cta: { label: "Add your references", url: statusUrl },
    siteUrl,
  });
}
