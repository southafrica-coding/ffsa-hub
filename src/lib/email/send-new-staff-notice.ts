// New-staff-onboarded notice — tells the Hub's people admins when someone
// finishes the onboarding wizard.
//
// Recipients come from STAFF_SIGNUP_NOTIFY_EMAIL (comma-separated). If the
// var is unset the whole feature is a silent no-op: no send, no error. The
// same list gates the matching dashboard notification (see
// services/notifications.ts), so one env var controls both surfaces.

import { newStaffOnboardedEmailHtml } from "./templates/new-staff-onboarded";
import { sendTransactional } from "./send-transactional";

/** Parsed, lower-cased recipient list. Empty when the feature is off. */
export function staffSignupNotifyEmails(): string[] {
  return (process.env.STAFF_SIGNUP_NOTIFY_EMAIL || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export type NewStaffPerson = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
  job_title?: string | null;
  department?: string | null;
};

export function staffDisplayName(u: NewStaffPerson): string {
  return (
    u.display_name ||
    [u.first_name, u.last_name].filter(Boolean).join(" ") ||
    u.email ||
    "A new staff member"
  );
}

export async function sendNewStaffOnboardedNotice(user: NewStaffPerson) {
  const recipients = staffSignupNotifyEmails();
  if (recipients.length === 0) return { sent: 0 };

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ffsahub.com";
  const name = staffDisplayName(user);
  const html = newStaffOnboardedEmailHtml({
    staffName: name,
    email: user.email ?? null,
    phone: user.phone ?? null,
    jobTitle: user.job_title ?? null,
    department: user.department ?? null,
    userId: user.id,
    siteUrl,
  });

  let sent = 0;
  for (const to of recipients) {
    const result = await sendTransactional({
      to,
      subject: `New staff member joined the HUB — ${name}`,
      html,
      category: "new_staff_onboarded",
      sourceType: "user",
      sourceId: user.id,
    });
    if (result.ok) sent += 1;
    else console.error("[new-staff-notice] send failed", to, result.error);
  }
  return { sent };
}
