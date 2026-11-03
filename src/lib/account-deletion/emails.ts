// The three emails behind an account deletion request: the admin notice,
// the person's confirmation, and the admin "cancelled" notice. HTML only;
// sending lives in ./notify.ts.

import { renderEmailShell, escapeHtml, bodyParagraph, emphasis } from "@/lib/email/shell";
import { DELETION_DAYS, RECORDS_WE_KEEP } from "./config";

export const DELETION_PAGE_PATH = "/legal/delete-account";

function list(items: readonly string[]): string {
  return `<ul style="margin:8px 0 16px;padding-left:20px;">${items
    .map((i) => `<li style="margin:0 0 6px;line-height:1.6;">${escapeHtml(i)}</li>`)
    .join("")}</ul>`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  });
}

export type DeletionPerson = { userId: string; name: string; email: string | null };

/** To the admins: someone asked for their account to be deleted. */
export function deletionRequestAdminEmail(args: {
  person: DeletionPerson;
  reason: string | null;
  requestedAt: string;
  source: "app" | "web";
  recorded: boolean;
  siteUrl: string;
}) {
  const { person, reason, requestedAt, source, recorded, siteUrl } = args;
  const subject = `Account deletion request: ${person.name}`;
  const html = renderEmailShell({
    title: "Account deletion request",
    preheader: `${person.name} asked for their Hub account to be deleted.`,
    eyebrow: "Account deletion request",
    heading: "Someone asked us to delete their account",
    bodyHtml: `
      ${bodyParagraph(
        `${emphasis(escapeHtml(person.name))}${person.email ? ` (${escapeHtml(person.email)})` : ""} asked on ${escapeHtml(
          formatDate(requestedAt)
        )} for their FFSA Hub account to be deleted (from the ${source === "app" ? "phone app" : "website"}).`
      )}
      ${reason ? bodyParagraph(`Their reason: “${escapeHtml(reason)}”`) : ""}
      ${bodyParagraph(
        `We told them it will be done within ${DELETION_DAYS} days and that these records are kept:`
      )}
      ${list(RECORDS_WE_KEEP)}
      ${bodyParagraph(
        "Nothing has been deleted yet. Check what must be kept, then delete the user from Users in the Hub."
      )}
      ${
        recorded
          ? ""
          : bodyParagraph(
              "This request was NOT saved in the Hub (the deletion-requests table isn't set up yet), so this email is the only record of it. Keep it."
            )
      }
    `,
    cta: { label: "Open their profile", url: `${siteUrl}/users/${person.userId}` },
    siteUrl,
  });
  return { subject, html };
}

/** To the person: we have your request. */
export function deletionRequestConfirmationEmail(args: {
  name: string;
  requestedAt: string;
  contactEmail: string;
  siteUrl: string;
}) {
  const { name, requestedAt, contactEmail, siteUrl } = args;
  const subject = "We received your request to delete your FFSA Hub account";
  const html = renderEmailShell({
    title: "Account deletion request",
    preheader: `We'll finish within ${DELETION_DAYS} days.`,
    eyebrow: "Account deletion request",
    heading: "We received your request",
    bodyHtml: `
      ${bodyParagraph(`Hi ${escapeHtml(name)},`)}
      ${bodyParagraph(
        `We received your request on ${escapeHtml(formatDate(requestedAt))} to delete your FFSA Hub account. A member of our team will finish it within ${DELETION_DAYS} days and email you when it's done.`
      )}
      ${bodyParagraph("Until then your account keeps working as normal.")}
      ${bodyParagraph("Some records are kept because the law requires it:")}
      ${list(RECORDS_WE_KEEP)}
      ${bodyParagraph(
        `Changed your mind? Cancel the request in the app (Me → Request account deletion) or on the website, or email ${escapeHtml(
          contactEmail
        )}.`
      )}
      ${bodyParagraph(`Didn't ask for this? Email ${escapeHtml(contactEmail)} straight away.`)}
    `,
    cta: { label: "See your request", url: `${siteUrl}${DELETION_PAGE_PATH}` },
    siteUrl,
  });
  return { subject, html };
}

/** To the admins: the person cancelled their request. */
export function deletionCancelledAdminEmail(args: { person: DeletionPerson; siteUrl: string }) {
  const { person, siteUrl } = args;
  const subject = `Account deletion cancelled: ${person.name}`;
  const html = renderEmailShell({
    title: "Account deletion cancelled",
    preheader: `${person.name} no longer wants their account deleted.`,
    eyebrow: "Account deletion request",
    heading: "Request cancelled",
    bodyHtml: bodyParagraph(
      `${emphasis(escapeHtml(person.name))}${person.email ? ` (${escapeHtml(person.email)})` : ""} cancelled their request to delete their FFSA Hub account. Don't delete it.`
    ),
    siteUrl,
  });
  return { subject, html };
}
