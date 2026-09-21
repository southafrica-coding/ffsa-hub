import { renderEmailShell, escapeHtml, bodyParagraph, emphasis } from "../shell";

export function ffxTrackIntentEmailHtml({
  firstName,
  surveyUrl,
  siteUrl,
}: {
  firstName: string;
  surveyUrl: string;
  siteUrl?: string | null;
}): string {
  return renderEmailShell({
    title: "Which part of FFX 2027 are you doing?",
    preheader: "Quick one — tell us whether you're doing the whole programme or specific sections.",
    eyebrow: "Fire & Fragrance SA Experience 2027",
    heading: `Hi ${escapeHtml(firstName)}`,
    bodyHtml: `
      ${bodyParagraph("We're confirming exactly who's doing what for FFX 2027, so we can plan accurately.")}
      ${bodyParagraph(`Please let us know: are you doing the ${emphasis("whole programme")}, or just ${emphasis("one or more of the three sections")} (FFX, FFBX, FFWX)?`)}
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
