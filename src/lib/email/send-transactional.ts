// FFSA Hub — Transactional email send, logged + suppression-aware.
//
// The single entry point for Resend transactional mail (schools /
// applicant lifecycle, invites, references, reminders). It does three
// things every raw getResend().emails.send() call was missing:
//
//   1. Suppression pre-check — never send to an address that hard-bounced
//      or filed a spam complaint (email_suppressions, migration 046). A
//      suppressed send is recorded as 'dropped' and skipped.
//   2. Ledger write (email_messages, migration 141) — queued → sent, or
//      failed if Resend rejects it. So every school email becomes a
//      visible, per-person delivery record like ticket emails already are.
//   3. Consistent From identity.
//
// Best-effort logging: a ledger hiccup never blocks the actual send.
// Callers get a simple { ok, id, error, suppressed } result.

import { createAdminClient } from "@/lib/supabase/admin";
import { recordEmail, markSent, markFailed, markDropped } from "./ledger";
import { getResend } from "@/lib/email/resend";
import { loadProgramEmailAttachments } from "./program-email-documents";

export type SendTransactionalInput = {
  to: string;
  subject: string;
  html: string;
  /** Ledger category, e.g. 'application_accepted', 'reference_request'. */
  category: string;
  fromName?: string;
  /** Send from this address instead of the default (an event's sender, migration 241). */
  fromEmail?: string;
  /** Where replies go — an event sender's Hub inbox. */
  replyTo?: string | null;
  /** Best-effort CRM link for the per-contact email history. */
  contactId?: string | null;
  /** Generic source linkage for non-contact records (schools etc.). */
  sourceType?: string | null;
  sourceId?: string | null;
  /**
   * WHY she is getting this, in plain words — read straight out by the
   * person log (frame 29d). Callers know the answer; the ledger does not.
   * Falls back to the category, which is better than nothing but is a
   * label rather than an explanation.
   */
  reason?: string | null;
  /**
   * Attach the documents this school uploaded for this email (migration
   * 238). A missing programId sends with no documents.
   */
  programDocuments?: {
    programId: string | null | undefined;
    /** Several when one email stands in for another step's too. */
    emailType: string | string[];
  };
};

export type SendTransactionalResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string; suppressed: boolean };

export async function sendTransactional(
  input: SendTransactionalInput
): Promise<SendTransactionalResult> {
  const admin = createAdminClient();
  const toNorm = input.to.trim().toLowerCase();

  const ledgerFields = {
    toEmail: input.to,
    provider: "resend" as const,
    category: input.category,
    subject: input.subject,
    contactId: input.contactId ?? null,
    sourceType: input.sourceType ?? null,
    sourceId: input.sourceId ?? null,
    reason: input.reason ?? `Transactional: ${input.category}`,
  };

  // 1. Suppression pre-check. A suppressed recipient is a known-bad
  //    address; sending again just harms sender reputation. Record the
  //    intent as 'dropped' so it still shows up in the history, and skip.
  const { data: supp } = await admin
    .from("email_suppressions")
    .select("reason")
    .eq("email_normalized", toNorm)
    .maybeSingle();
  if (supp) {
    const id = await recordEmail(admin, ledgerFields);
    await markDropped(admin, id, `suppressed: ${supp.reason}`);
    return {
      ok: false,
      error: `Recipient is on the suppression list (${supp.reason})`,
      suppressed: true,
    };
  }

  // 2. Record the queued row before sending.
  const ledgerId = await recordEmail(admin, ledgerFields);

  // 3. The school's documents for this email, if any.
  const attachments = input.programDocuments?.programId
    ? await loadProgramEmailAttachments(
        admin,
        input.programDocuments.programId,
        ([] as string[]).concat(input.programDocuments.emailType)
      )
    : [];
  if (ledgerId && attachments.length > 0) {
    try {
      // attachments (migration 238) isn't in the generated types yet.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from("email_messages")
        .update({
          attachments: attachments.map((a) => ({
            name: a.filename,
            size: a.content.length,
          })),
        })
        .eq("id", ledgerId);
    } catch {
      // column not migrated yet — the send matters more than the record
    }
  }

  // 4. Send.
  const fromEmail = (
    input.fromEmail || process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com"
  ).trim();
  const fromName = input.fromName || "Fire & Fragrance SA";
  const { data, error } = await getResend().emails.send({
    from: `${fromName} <${fromEmail}>`,
    to: input.to,
    subject: input.subject,
    html: input.html,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  });

  if (error) {
    const message =
      typeof error === "string"
        ? error
        : error.message ?? "Resend send failed";
    await markFailed(admin, ledgerId, message);
    return { ok: false, error: message, suppressed: false };
  }
  await markSent(admin, ledgerId, data?.id ?? null);
  return { ok: true, id: data?.id ?? null };
}
