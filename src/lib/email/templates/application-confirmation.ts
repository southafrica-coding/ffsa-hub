import { renderEmailShell, escapeHtml, bodyParagraph, emphasis } from "../shell";
import {
  referenceCountIsAre,
  referenceCountPossessive,
  referenceSubmittedNote,
} from "@/lib/references/reference-status-copy";

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
      ? // The wait for references is stated in the body itself, so the panel
        // below drops its own version of it and the tracker pointer moves there.
        `
      ${bodyParagraph(`Your application to ${emphasis(escapeHtml(programName))} has been received.`)}
      ${bodyParagraph(
        `Our team will review your application once ${referenceCountPossessive(
          referenceCount
        )} ${referenceCountIsAre(referenceCount)} submitted and get back to you as soon as possible.`
      )}
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
          // The body above already says the review waits on the references.
          includeWaitNote: false,
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
 *
 * `includeWaitNote` is what keeps that guarantee honest in both directions. The
 * FFSA default body states the wait itself, so it passes false and the panel is
 * purely the reassuring half. A leader's custom body may say nothing about
 * references at all, so the send site leaves it on and the panel states the wait
 * — an applicant is never told to sit tight without being told what for.
 */
export function applicationReferenceNotice(
  referenceCount: number,
  opts?: { hasTracker?: boolean; includeWaitNote?: boolean }
): { label: string; html: string } {
  const referees =
    referenceCount === 1 ? "Your referee has" : "Your referees have each";
  const tracker = opts?.hasTracker
    ? referenceCount === 1
      ? " You can see when it arrives on your application tracker below."
      : " You can see when each one arrives on your application tracker below."
    : "";
  const waitNote =
    opts?.includeWaitNote === false
      ? ""
      : `${escapeHtml(referenceSubmittedNote(referenceCount))} `;
  return {
    label: referenceCount === 1 ? "Your reference" : "Your references",
    html:
      waitNote +
      `${referees} been emailed a link, so there's nothing more you need to do.` +
      tracker,
  };
}
