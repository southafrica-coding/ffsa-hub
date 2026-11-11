import { renderEmailShell, escapeHtml, bodyParagraph, emphasis } from "../shell";

// Sent to a person when they are invited to fill a roster slot in a devo set.
export function prayerRoomInviteEmailHtml({
  inviteeFirstName,
  roleLabel,
  setWhen,
  setTitle,
  ownerName,
  siteUrl,
}: {
  inviteeFirstName: string;
  roleLabel: string;
  setWhen: string;
  setTitle: string;
  ownerName: string;
  siteUrl: string;
}): string {
  return renderEmailShell({
    title: "Devo set invitation",
    preheader: `${roleLabel} · ${setWhen}`,
    eyebrow: "Devo Set Invitation",
    heading: "You're invited to a devo set",
    bodyHtml: `
      ${bodyParagraph(`Hi ${escapeHtml(inviteeFirstName)}, ${emphasis(escapeHtml(ownerName))} has invited you to serve as ${emphasis(escapeHtml(roleLabel))}.`)}
      ${bodyParagraph(`${emphasis(escapeHtml(setTitle))}<br/>${escapeHtml(setWhen)}`)}
      ${bodyParagraph("Open the Prayer room to accept or decline.")}
    `,
    cta: { label: "Respond to Invite", url: `${siteUrl}/prayer-room` },
    siteUrl,
  });
}
