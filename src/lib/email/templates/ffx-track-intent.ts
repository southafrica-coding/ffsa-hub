import { renderEmailShell, escapeHtml, bodyParagraph, emphasis } from "../shell";

export function ffxTrackIntentEmailHtml({
  firstName,
  surveyUrl,
  siteUrl,
  programName,
  segmentNames,
  reminder = false,
}: {
  firstName: string;
  surveyUrl: string;
  siteUrl?: string | null;
  programName: string;
  segmentNames: string[];
  reminder?: boolean;
}): string {
  const title = reminder
    ? `Reminder: which part of ${programName} are you doing?`
    : `Which part of ${programName} are you doing?`;
  return renderEmailShell({
    title,
    preheader: "Quick one — tell us whether you're doing the whole programme or specific sections.",
    eyebrow: programName,
    heading: `Hi ${escapeHtml(firstName)}`,
    bodyHtml: `
      ${bodyParagraph(
        reminder
          ? `A quick reminder — we still haven't heard which part of ${escapeHtml(programName)} you're doing.`
          : `We're confirming exactly who's doing what for ${escapeHtml(programName)}, so we can plan accurately.`
      )}
      ${bodyParagraph(`Please let us know: are you doing the ${emphasis("whole programme")}, or just ${emphasis("one or more of the sections")} (${escapeHtml(segmentNames.join(", "))})?`)}
      ${bodyParagraph("It only takes a moment — click below to tell us.")}
      <p style="margin:24px 0 0;font-size:13px;color:#5a4e42;line-height:1.5;">
        If the button doesn't work, copy and paste this link into your browser:<br/>
        <a href="${escapeHtml(surveyUrl)}" style="color:#F5C518;word-break:break-all;">${escapeHtml(surveyUrl)}</a>
      </p>
    `,
    cta: { label: "Tell us your plans", url: surveyUrl },
    siteUrl,
  });
}
