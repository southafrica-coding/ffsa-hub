// FFSA Hub — Resolve a program email against its per-program override
// (migration 146).
//
// No override → the built-in default the caller passed is sent unchanged
// (the polished bespoke template). If a school's leaders have customized
// that email type, their subject/body wins — rendered through the FFSA
// shell using that email's catalog eyebrow/heading, with every merge
// token filled in and the required action button re-appended, so a leader
// controls the words without breaking the email or dropping a link.
//
// Tolerant by design: if the templates table isn't there yet, or the
// lookup fails, the built-in default is used — so this ships safely ahead
// of the migration.

import { renderEmailShell } from "./shell";
import { plainTextToEmailHtml, substituteTokens } from "./placeholders";
import { getProgramEmailType } from "./program-email-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type ProgramEmailContext = {
  /** All merge tokens available to this email, already resolved to real
   *  values — e.g. { first_name, program_name, applicant_name, ... }. */
  values: Record<string, string>;
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
    row = null; // table not migrated / read failed → default
  }

  // A leader can switch an email off entirely.
  if (row && row.enabled === false) return { skip: true };

  const hasSubject = !!row?.subject && row.subject.trim().length > 0;
  const hasBody = !!row?.body && row.body.trim().length > 0;

  // Nothing customized → send the built-in default exactly as-is.
  if (!hasSubject && !hasBody) {
    return { skip: false, subject: defaults.subject, html: defaults.html };
  }

  const catalog = getProgramEmailType(emailType);
  const subjectTemplate = hasSubject
    ? (row!.subject as string)
    : catalog?.defaultSubject ?? defaults.subject;
  const bodyTemplate = hasBody
    ? (row!.body as string)
    : catalog?.defaultBody ?? "";

  const subject = substituteTokens(subjectTemplate, ctx.values);
  const heading = substituteTokens(
    catalog?.defaultHeading ?? "",
    ctx.values
  );
  const html = renderEmailShell({
    eyebrow: catalog?.defaultEyebrow ?? ctx.values.program_name ?? "FFSA",
    heading: heading || ctx.values.program_name || "",
    bodyHtml: plainTextToEmailHtml(substituteTokens(bodyTemplate, ctx.values)),
    cta: ctx.cta,
    siteUrl: ctx.siteUrl ?? undefined,
  });

  return { skip: false, subject, html };
}
