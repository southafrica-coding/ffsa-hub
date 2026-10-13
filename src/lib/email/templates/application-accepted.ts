import { renderEmailShell, escapeHtml, bodyParagraph, emphasis } from "../shell";

/**
 * The acceptance email. Two shapes:
 *  - `inviteUrl` — the setup link goes out now, as a button.
 *  - `setupInviteOn` — the link is held back until nearer the start
 *    (migration 230), so the email says when to expect it instead.
 */
export function applicationAcceptedEmailHtml({
  firstName,
  programName,
  inviteUrl,
  setupInviteOn,
  customBodyHtml,
  siteUrl,
}: {
  firstName: string;
  programName: string;
  inviteUrl?: string | null;
  /** Human date, e.g. "15 January 2027". Used only when there's no inviteUrl. */
  setupInviteOn?: string | null;
  customBodyHtml?: string | null;
  siteUrl?: string | null;
}): string {
  const bodyHtml = customBodyHtml ?? `
      ${bodyParagraph(`Hi ${escapeHtml(firstName)},`)}
      ${bodyParagraph(`We're excited to let you know that your application to ${emphasis(escapeHtml(programName))} has been accepted!`)}
      ${inviteUrl ? bodyParagraph("Click the button below to set up your account on FFSA Hub and get started.") : ""}
    `;

  const accountHtml = inviteUrl
    ? `
      <p style="margin:24px 0 4px;font-size:12px;color:#5a4e44;line-height:1.6;">If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="margin:0;font-size:11px;color:#7a6e64;word-break:break-all;line-height:1.6;">
        <a href="${escapeHtml(inviteUrl)}" style="color:#F5C518;text-decoration:none;">${escapeHtml(inviteUrl)}</a>
      </p>`
    : bodyParagraph(
        `${emphasis("Your FFSA Hub account:")} we'll email you a link to set it up${
          setupInviteOn ? ` on ${emphasis(escapeHtml(setupInviteOn))}` : " closer to the start"
        }. There's nothing you need to do until then.`
      );

  return renderEmailShell({
    title: "You've Been Accepted",
    preheader: `Your ${programName} application has been accepted.`,
    eyebrow: "Congratulations",
    heading: "You&rsquo;ve Been<br/>Accepted!",
    bodyHtml: `
      ${bodyHtml}
      ${accountHtml}
    `,
    cta: inviteUrl ? { label: "Set Up Your Account", url: inviteUrl } : undefined,
    siteUrl,
  });
}
