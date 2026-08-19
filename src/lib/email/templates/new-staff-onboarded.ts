import { renderEmailShell, escapeHtml, bodyParagraph, emphasis, EMAIL_COLORS } from "../shell";

// Sent to the people on STAFF_SIGNUP_NOTIFY_EMAIL when a new staff member
// finishes the onboarding wizard. Internal notice — the recipient is an
// admin, not the new staff member, so it links straight to their profile.
export function newStaffOnboardedEmailHtml({
  staffName,
  email,
  phone,
  jobTitle,
  department,
  userId,
  siteUrl,
}: {
  staffName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  department: string | null;
  userId: string;
  siteUrl: string;
}): string {
  const C = EMAIL_COLORS;

  // Only render the rows we actually have — a half-empty detail list reads
  // like something failed to load.
  const rows: Array<[string, string]> = [];
  if (email) rows.push(["Email", email]);
  if (phone) rows.push(["Phone", phone]);
  if (jobTitle) rows.push(["Job title", jobTitle]);
  if (department) rows.push(["Ministry", department]);

  const detailHtml = rows
    .map(
      ([label, value]) =>
        `<p style="margin:0 0 6px;font-size:13px;color:${C.TEXT_DIM};line-height:1.6;">` +
        `<span style="color:${C.TEXT_FAINT};text-transform:uppercase;letter-spacing:0.1em;font-size:11px;">${escapeHtml(label)}</span>` +
        `&nbsp;&nbsp;${escapeHtml(value)}</p>`
    )
    .join("");

  return renderEmailShell({
    title: "New Staff Member",
    preheader: `${staffName} has finished onboarding.`,
    eyebrow: "New Staff Member",
    heading: "Someone new joined the Hub",
    bodyHtml: `
      ${bodyParagraph(`${emphasis(escapeHtml(staffName))} has completed their onboarding and their profile is now active. Check their roles, ministry and permissions when you get a chance.`)}
      ${detailHtml ? `<div style="margin:16px 0 0;">${detailHtml}</div>` : ""}
    `,
    cta: { label: "Open Their Profile", url: `${siteUrl}/users/${userId}` },
    siteUrl,
  });
}
