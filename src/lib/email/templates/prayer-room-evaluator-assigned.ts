import { renderEmailShell, escapeHtml, bodyParagraph, emphasis } from "../shell";

// Sent to an evaluator when a coordinator assigns them a prayer-room applicant.
export function prayerRoomEvaluatorAssignedEmailHtml({
  evaluatorFirstName,
  applicantName,
  skillsLine,
  siteUrl,
}: {
  evaluatorFirstName: string;
  applicantName: string;
  skillsLine: string;
  siteUrl: string;
}): string {
  return renderEmailShell({
    title: "Applicant assigned to you",
    preheader: `Please evaluate ${applicantName}.`,
    eyebrow: "Evaluation Requested",
    heading: "You've been asked to evaluate",
    bodyHtml: `
      ${bodyParagraph(`Hi ${escapeHtml(evaluatorFirstName)}, you've been asked to meet with and evaluate ${emphasis(escapeHtml(applicantName))} for the prayer room team.`)}
      ${skillsLine ? bodyParagraph(`They'd like to serve in: ${escapeHtml(skillsLine)}.`) : ""}
      ${bodyParagraph("Open the Prayer room to record your notes and decision once you've met.")}
    `,
    cta: { label: "Open Evaluation", url: `${siteUrl}/prayer-room` },
    siteUrl,
  });
}
