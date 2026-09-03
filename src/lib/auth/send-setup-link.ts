// FFSA Hub — mint a 30-day /setup token and actually email it.
//
// The one place that does both halves. Previously each caller did its own
// thing: accept-application minted a token and discarded the send result;
// resend-invite generated a short-lived Supabase magic link instead of a
// token; forgot-password did neither. All of them reported success either
// way, so "invite sent" in the UI meant nothing.
//
// This returns a real result. Callers must not report success without it.

import { createAdminClient } from "@/lib/supabase/admin";
import { createOnboardingInvite } from "@/lib/auth/onboarding-invite";
import { sendTransactional } from "@/lib/email/send-transactional";
import { accountSetupEmailHtml } from "@/lib/email/templates/account-setup";

type AdminClient = ReturnType<typeof createAdminClient>;

export function resolveSiteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}

export type SendSetupLinkResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Issue a fresh setup link and email it. Supersedes any earlier unused token
 * for the user, so only the newest link works.
 */
export async function sendSetupLink(
  admin: AdminClient,
  {
    userId,
    email,
    firstName,
    createdBy,
    subject,
    html,
    category = "account_setup_link",
    sourceType,
    sourceId,
    reason,
  }: {
    userId: string;
    email: string;
    firstName?: string | null;
    createdBy?: string | null;
    /** Override the default copy (the acceptance email supplies its own). */
    subject?: string;
    html?: (setupUrl: string) => string;
    category?: string;
    sourceType?: string | null;
    sourceId?: string | null;
    reason?: string | null;
  }
): Promise<SendSetupLinkResult> {
  const siteUrl = resolveSiteUrl();

  const invite = await createOnboardingInvite(admin, {
    userId,
    email,
    siteUrl,
    createdBy: createdBy ?? null,
  });

  if (!invite.ok) {
    return { ok: false, error: `Could not create setup link: ${invite.error}` };
  }

  const sendResult = await sendTransactional({
    to: email,
    subject: subject ?? "Finish setting up your FFSA Hub account",
    html: html
      ? html(invite.url)
      : accountSetupEmailHtml({
          firstName: firstName || undefined,
          setupUrl: invite.url,
          siteUrl,
        }),
    category,
    sourceType: sourceType ?? null,
    sourceId: sourceId ?? null,
    reason:
      reason ??
      "They have an FFSA Hub account with no password yet and asked for a setup link.",
  });

  if (!sendResult.ok) {
    return { ok: false, error: sendResult.error };
  }

  return { ok: true, url: invite.url };
}
