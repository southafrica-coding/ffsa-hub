// FFSA Hub — Resolve a program email against its per-program override
// (migration 146). Each school send passes the built-in default; if the
// school's leaders have customized that email type, their subject/body
// wins — but the body is always re-wrapped in FFSA branding and the
// required action button is re-appended, so a leader controls the words
// without being able to break the email or drop a critical link.
//
// Tolerant by design: if the templates table isn't there yet, or the
// lookup fails, the built-in default is used — so this ships safely
// ahead of the migration.

import { renderEmailShell } from "./shell";
import { substitutePlaceholders, plainTextToEmailHtml } from "./placeholders";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type ProgramEmailContext = {
  /** Applicant first name (applicant emails). Referee emails omit it. */
  firstName?: string | null;
  programName: string;
  /** Heading for the custom-body render. Defaults to the program name. */
  heading?: string;
  /** Guaranteed action button re-appended below a custom body. */
  cta?: { label: string; url: string };
  siteUrl?: string | null;
};

export type ResolvedProgramEmail =
  | { skip: true }
  | { skip: false; subject: string; html: string };

export async function resolveProgramEmail(
  admin: Client,
  programId: string,
  emailType: string,
  defaults: { subject: string; html: string },
  ctx: ProgramEmailContext
): Promise<ResolvedProgramEmail> {
  let row: {
    enabled: boolean;
    subject: string | null;
    body: string | null;
  } | null = null;

  try {
    const { data } = await admin
      .from("program_email_templates")
      .select("enabled, subject, body")
      .eq("program_id", programId)
      .eq("email_type", emailType)
      .maybeSingle();
    row = data ?? null;
  } catch {
    // Table not migrated yet / read failed — fall back to the default.
    row = null;
  }

  // A leader can switch an email off entirely.
  if (row && row.enabled === false) return { skip: true };

  const values = {
    first_name: ctx.firstName || "there",
    program_name: ctx.programName,
  };

  const subject =
    row?.subject && row.subject.trim()
      ? substitutePlaceholders(row.subject, values)
      : defaults.subject;

  let html = defaults.html;
  if (row?.body && row.body.trim()) {
    html = renderEmailShell({
      eyebrow: ctx.programName,
      heading: ctx.heading ?? ctx.programName,
      bodyHtml: plainTextToEmailHtml(substitutePlaceholders(row.body, values)),
      cta: ctx.cta,
      siteUrl: ctx.siteUrl ?? undefined,
    });
  }

  return { skip: false, subject, html };
}
