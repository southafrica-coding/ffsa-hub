import { Resend } from "resend";
import { referencesCompleteEmailHtml } from "./templates/references-complete";

const resend = new Resend(process.env.RESEND_API_KEY?.trim());

// Emails one recipient that every required reference for an application has
// been submitted — either the assigned staff member, or (when unassigned) a
// program leader who should assign it. Fire-and-forget: a send failure is
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
  // true → "needs assigning" copy sent to a program leader (no assignee yet).
  unassigned?: boolean;
}) {
  if (!opts.staff.email) return;

  const fromEmail = (process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com").trim();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ffsahub.com";
  const fromHeader = `Fire & Fragrance SA <${fromEmail}>`;

  const staffFirstName = opts.staff.preferred_name || opts.staff.first_name || "there";
  const subject = opts.unassigned
    ? `References complete — needs assigning — ${opts.applicantName} · ${opts.programName}`
    : `References complete — ${opts.applicantName} · ${opts.programName}`;

  try {
    await resend.emails.send({
      from: fromHeader,
      to: opts.staff.email,
      subject,
      html: referencesCompleteEmailHtml({
        staffFirstName,
        applicantName: opts.applicantName,
        programName: opts.programName,
        programId: opts.programId,
        siteUrl,
        unassigned: opts.unassigned,
      }),
    });
  } catch {
    console.error("Failed to send references-complete email", {
      to: opts.staff.email,
      unassigned: !!opts.unassigned,
    });
  }
}
