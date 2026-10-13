import { renderEmailShell, escapeHtml, bodyParagraph, emphasis } from "../shell";

/**
 * "Finish setting up your account" — for someone who already has an FFSA Hub
 * account but has never set a password (an accepted applicant whose original
 * invite was lost, expired, or never arrived). Deliberately not the
 * acceptance email: they already know they're in, they just can't get in.
 */
export function accountSetupEmailHtml({
  firstName,
  setupUrl,
  siteUrl,
  programName,
}: {
  firstName?: string;
  setupUrl: string;
  siteUrl?: string | null;
  /** Set for the scheduled pre-arrival invite (migration 230): the person
   *  didn't ask for this, their school is about to start. */
  programName?: string | null;
}): string {
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi,";
  const intro = programName
    ? `${emphasis(escapeHtml(programName))} is coming up soon, so it's time to set up your ${emphasis("FFSA Hub")} account. Click below to choose a password and sign in.`
    : `Your ${emphasis("FFSA Hub")} account is ready — it just needs a password. Click below to choose one and sign in.`;

  return renderEmailShell({
    title: "Finish setting up your FFSA Hub account",
    preheader: "Choose a password and get into your FFSA Hub account.",
    eyebrow: "Account Setup",
    heading: "Finish setting up<br/>your account",
    bodyHtml: `
      ${bodyParagraph(greeting)}
      ${bodyParagraph(intro)}
      ${bodyParagraph("This link works for 30 days and can only be used once.")}
      <p style="margin:24px 0 4px;font-size:12px;color:#5a4e44;line-height:1.6;">If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="margin:0;font-size:11px;color:#7a6e64;word-break:break-all;line-height:1.6;">
        <a href="${escapeHtml(setupUrl)}" style="color:#F5C518;text-decoration:none;">${escapeHtml(setupUrl)}</a>
      </p>
      ${programName ? "" : `<p style="margin:20px 0 0;font-size:12px;color:#5a4e44;line-height:1.6;">If you didn't ask for this, you can safely ignore this email.</p>`}
    `,
    cta: { label: "Set My Password", url: setupUrl },
    siteUrl,
  });
}
