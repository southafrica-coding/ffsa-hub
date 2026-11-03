// Account deletion request: who hears about it and what address people are
// told to write to. Both come from env vars, the same pattern as
// STAFF_SIGNUP_NOTIFY_EMAIL (no settings table exists for addresses).
//
//   ACCOUNT_DELETION_NOTIFY_EMAIL   comma-separated. When set, ONLY these
//                                   addresses get the admin notice. Unset:
//                                   every active super_admin / admin (the
//                                   people who can delete users today).
//   ACCOUNT_DELETION_CONTACT_EMAIL  shown to people when the Hub can't take
//                                   the request itself. Defaults to the
//                                   address already published on the privacy
//                                   agreement page.

export const DEFAULT_DELETION_CONTACT_EMAIL = "info@fireandfragrance.com";

/** How long FFSA promises to take. Shown in the emails and on the page. */
export const DELETION_DAYS = 30;

/** Parsed, lower-cased override list. Empty means "use the admins". */
export function deletionNotifyEmailsFromEnv(): string[] {
  return (process.env.ACCOUNT_DELETION_NOTIFY_EMAIL || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

export function deletionContactEmail(): string {
  const configured = (process.env.ACCOUNT_DELETION_CONTACT_EMAIL || "").trim();
  return configured.includes("@") ? configured : DEFAULT_DELETION_CONTACT_EMAIL;
}

/**
 * What FFSA keeps after an account is deleted, in plain words. One list, used
 * by the confirmation email, the web page and (copied) the phone app.
 */
export const RECORDS_WE_KEEP = [
  "Receipts, payments and invoices, because tax and accounting law requires it.",
  "Donor statements and donation records, for the same reason.",
  "School records: applications, enrolments, grades and certificates, so we can confirm your training later.",
  "Signed consent forms and agreements.",
] as const;

export const WHAT_WE_DELETE = [
  "Your sign-in, so the account can no longer be used.",
  "Your profile: name, phone, photo, address and other personal details.",
  "Your roles, permissions and settings.",
] as const;
