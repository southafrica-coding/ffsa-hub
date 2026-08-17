import { renderEmailShell, escapeHtml, bodyParagraph, emphasis } from "../shell";
import { referenceSubmittedNote } from "@/lib/references/reference-status-copy";

export function applicationConfirmationEmailHtml({
  firstName,
  programName,
  statusUrl,
  siteUrl,
  referenceCount = 0,
}: {
  firstName: string;
  programName: string;
  statusUrl?: string | null;
  siteUrl?: string | null;
  /**
   * References the applicant listed. When there are any, the email says the
   * application isn't finished until they're in rather than promising a review
   * that can't start yet.
   */
  referenceCount?: number;
}): string {
  const hasReferences = referenceCount > 0;

  return renderEmailShell({
    title: "Application Received",
    preheader: hasReferences
      ? `We've got your ${programName} application — now we just need your references.`
      : `We've received your ${programName} application.`,
    eyebrow: "Application Received",
    heading: `Thank You,<br/>${escapeHtml(firstName)}`,
    bodyHtml: hasReferences
      ? // The references panel carries the tracker pointer here, so this path
        // skips the fine-print line that would otherwise sit above it.
        `
      ${bodyParagraph(`Your application to ${emphasis(escapeHtml(programName))} has been received.`)}
      ${bodyParagraph("Our team will review it and get back to you as soon as we can — you'll receive an email once a decision has been made.")}
      ${bodyParagraph("If you have any questions in the meantime, feel free to reach out to us.")}
    `
      : `
      ${bodyParagraph(`Your application to ${emphasis(escapeHtml(programName))} has been received and is now under review.`)}
      ${bodyParagraph("Our team will review your application and get back to you as soon as possible. You'll receive an email once a decision has been made.")}
      ${bodyParagraph("If you have any questions in the meantime, feel free to reach out to us.")}
      ${statusUrl ? `<p style="margin:18px 0 0;font-size:13px;color:#5a4e42;line-height:1.5;">You can check your application status anytime using the button below.</p>` : ""}
    `,
    notice: hasReferences
      ? applicationReferenceNotice(referenceCount, {
          hasTracker: !!statusUrl,
        })
      : null,
    cta: statusUrl ? { label: "Track Your Application", url: statusUrl } : undefined,
    siteUrl,
  });
}

/**
 * The references panel. Lives here rather than inline so the send site can hand
 * the same block to resolveProgramEmail — a school that has rewritten its
 * "application received" copy still can't drop this.
 */
export function applicationReferenceNotice(
  referenceCount: number,
  opts?: { hasTracker?: boolean }
): { label: string; html: string } {
  const referees =
    referenceCount === 1 ? "Your referee has" : "Your referees have each";
  const tracker = opts?.hasTracker
    ? referenceCount === 1
      ? " You can see when it arrives on your application tracker below."
      : " You can see when each one arrives on your application tracker below."
    : "";
  return {
    label: referenceCount === 1 ? "Your reference" : "Your references",
    html:
      `${escapeHtml(referenceSubmittedNote(referenceCount))} ` +
      `${referees} been emailed a link, so there's nothing more you need to do.` +
      tracker,
  };
}
