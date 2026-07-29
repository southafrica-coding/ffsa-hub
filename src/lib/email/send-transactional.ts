// FFSA Hub — Transactional email send, logged + suppression-aware.
//
// The single entry point for Resend transactional mail (schools /
// applicant lifecycle, invites, references, reminders). It does three
// things every raw resend.emails.send() call was missing:
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

import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordEmail, markSent, markFailed, markDropped } from "./ledger";

const resend = new Resend(process.env.RESEND_API_KEY?.trim());

export type SendTransactionalInput = {
  to: string;
  subject: string;
  html: string;
  /** Ledger category, e.g. 'application_accepted', 'reference_request'. */
  category: string;
  fromName?: string;
  /** Best-effort CRM link for the per-contact email history. */
  contactId?: string | null;
  /** Generic source linkage for non-contact records (schools etc.). */
  sourceType?: string | null;
  sourceId?: string | null;
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

  // 3. Send.
  const fromEmail = (
    process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com"
  ).trim();
  const fromName = input.fromName || "Fire & Fragrance SA";
  const { data, error } = await resend.emails.send({
    from: `${fromName} <${fromEmail}>`,
    to: input.to,
    subject: input.subject,
    html: input.html,
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
