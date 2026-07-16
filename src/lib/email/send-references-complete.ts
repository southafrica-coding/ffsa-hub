import { Resend } from "resend";
import { referencesCompleteEmailHtml } from "./templates/references-complete";

const resend = new Resend(process.env.RESEND_API_KEY);

// Emails the staff member an application is assigned to, telling them every
// required reference has been submitted. Fire-and-forget: a send failure is
// logged but never thrown, so the referee's submission is unaffected.
export async function sendReferencesCompleteEmail(opts: {
  staff: {
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    preferred_name?: string | null;
  };
  applicantName: string;
  programName: string;
  programId: string;
}) {
  if (!opts.staff.email) return;

  const fromEmail = process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ffsahub.com";
  const fromHeader = `Fire & Fragrance SA <${fromEmail}>`;

  const staffFirstName = opts.staff.preferred_name || opts.staff.first_name || "there";

  try {
    await resend.emails.send({
      from: fromHeader,
      to: opts.staff.email,
      subject: `References complete — ${opts.applicantName} · ${opts.programName}`,
      html: referencesCompleteEmailHtml({
        staffFirstName,
        applicantName: opts.applicantName,
        programName: opts.programName,
        programId: opts.programId,
        siteUrl,
      }),
    });
  } catch {
    console.error("Failed to send references-complete email to assigned staff");
  }
}
