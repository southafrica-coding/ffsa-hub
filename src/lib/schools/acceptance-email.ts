// FFSA Hub — "You're accepted" email for applicants who already have an account.
//
// Accepting an application could go down four roads, and only one of them
// reliably told the student:
//
//   1. Accept route, brand-new applicant → account created + acceptance email
//      with setup link. (Worked.)
//   2. Accept route, application already linked to an account (applied while
//      signed in, or linked earlier) → NO email at all.
//   3. Accept route, public applicant whose email matches an existing account
//      → enrolment confirmation sent, but a failed send was ignored.
//   4. Applicants-list status control / bulk "accepted" → NO email at all
//      (sendStatusEmail returned early for "accepted").
//
// Roads 2–4 all mean "this person already has a HUB account; tell them they
// are in". This module is that one send, with its result turned into a
// plain-language warning for the admin instead of being swallowed.

import { sendTransactional, type SendTransactionalResult } from "@/lib/email/send-transactional";
import { enrollmentConfirmationEmailHtml } from "@/lib/email/templates/enrollment-confirmation";
import { substitutePlaceholders, plainTextToEmailHtml } from "@/lib/email/placeholders";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type AcceptanceProgram = {
  name: string;
  acceptance_email_subject: string | null;
  acceptance_email_body: string | null;
};

/** Escape LIKE/ILIKE wildcards so an address like a_b@x.com matches itself only. */
export function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The admin-facing warning for a failed acceptance send, or null when it went
 * out. Shared by every accept path so the wording is the same everywhere.
 */
export function acceptanceEmailWarning(
  result: SendTransactionalResult | null,
  email: string | null
): string | null {
  if (!email) {
    return "No email address is on file for this applicant, so no acceptance email was sent.";
  }
  if (!result || result.ok) return null;
  return result.suppressed
    ? `${email} is on the email suppression list (previous bounce or spam complaint), so the acceptance email was not sent. Check the address with them.`
    : `The acceptance email to ${email} failed to send: ${result.error}.`;
}

/** Subject + body for the "you're enrolled" email, honouring the school's custom copy. */
export function buildEnrollmentConfirmation(
  program: AcceptanceProgram,
  firstName: string,
  siteUrl: string
): { subject: string; html: string } {
  const placeholders = { first_name: firstName, program_name: program.name };
  const subject = program.acceptance_email_subject
    ? substitutePlaceholders(program.acceptance_email_subject, placeholders)
    : `You're enrolled in ${program.name}`;
  const customBodyHtml = program.acceptance_email_body
    ? plainTextToEmailHtml(substitutePlaceholders(program.acceptance_email_body, placeholders))
    : null;
  return {
    subject,
    html: enrollmentConfirmationEmailHtml({
      firstName,
      programName: program.name,
      siteUrl,
      customBodyHtml,
    }),
  };
}

/**
 * Send the acceptance ("you're enrolled") email to the account linked to an
 * application. Loads everything it needs from the response id, so any accept
 * path can call it after it has linked the account.
 *
 * Never throws. Returns { sent, warning } — warning is null on success.
 */
export async function sendAcceptanceToLinkedAccount(
  admin: Client,
  responseId: string,
  opts: { siteUrl?: string } = {}
): Promise<{ sent: boolean; email: string | null; warning: string | null }> {
  try {
    const { data: resp } = await admin
      .from("application_responses")
      .select(
        "id, program_id, user_id, applicant_email, applicant_info, programs(name, acceptance_email_subject, acceptance_email_body)"
      )
      .eq("id", responseId)
      .maybeSingle();
    if (!resp) {
      return { sent: false, email: null, warning: "Application not found, so no acceptance email was sent." };
    }

    let account: { email: string | null; first_name: string | null } | null = null;
    if (resp.user_id) {
      const { data } = await admin
        .from("users")
        .select("email, first_name")
        .eq("id", resp.user_id)
        .maybeSingle();
      account = data ?? null;
    }

    const info = (resp.applicant_info ?? {}) as { email?: string; first_name?: string };
    // The account's address wins: it is the one they sign in with and the one
    // the rest of the HUB writes to.
    const email = (account?.email || resp.applicant_email || info.email || "").trim() || null;
    const firstName = account?.first_name || info.first_name || "there";

    if (!email) {
      return { sent: false, email: null, warning: acceptanceEmailWarning(null, null) };
    }

    const program: AcceptanceProgram = resp.programs ?? {
      name: "your school",
      acceptance_email_subject: null,
      acceptance_email_body: null,
    };
    const siteUrl = opts.siteUrl || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const { subject, html } = buildEnrollmentConfirmation(program, firstName, siteUrl);

    const result = await sendTransactional({
      to: email,
      subject,
      html,
      category: "enrollment_confirmation",
      sourceType: "school_application",
      sourceId: responseId,
      reason: `Accepted into ${program.name}`,
      programDocuments: { programId: resp.program_id, emailType: "application_accepted" },
    });
    return { sent: result.ok, email, warning: acceptanceEmailWarning(result, email) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[acceptance-email] send threw:", msg);
    return { sent: false, email: null, warning: `The acceptance email could not be sent: ${msg}.` };
  }
}
