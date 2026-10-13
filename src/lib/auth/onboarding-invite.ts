// FFSA Hub — app-controlled onboarding setup tokens (migration 158).
//
// Replaces the Supabase magic-link invite (max 24h, one-time, burned by
// email scanners) with a token we own: a 30-day, single-use link at
// /setup/<token> that lets an accepted applicant / invited user set their
// password and finish onboarding. Backed by public.onboarding_invites and
// only ever read/written by the service-role admin client.

import { randomBytes } from "crypto";

/** 30 days — the setup link's lifetime. */
export const ONBOARDING_INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Build the public setup URL for a token. */
export function onboardingSetupUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/$/, "")}/setup/${token}`;
}

/**
 * Create a fresh 30-day onboarding token for a user and return its setup URL.
 * Any prior unused token for the same user is invalidated first, so only the
 * most recently emailed link works (a resend supersedes the old one).
 *
 * `admin` must be a service-role client (createAdminClient()).
 */
export async function createOnboardingInvite(
  // onboarding_invites isn't in the generated Database types yet; the repo
  // convention is to cast the admin client to any for not-yet-typed tables.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  {
    userId,
    email,
    siteUrl,
    createdBy,
  }: { userId: string; email: string; siteUrl: string; createdBy?: string | null }
): Promise<{ ok: true; token: string; url: string } | { ok: false; error: string }> {
  // Supersede any still-open token for this user so a resend invalidates the
  // previously emailed link. This is NOT the same as the token being used:
  // stamping used_at here made the setup page tell people who had never set
  // anything up that they were "already set up", and send them to a login
  // they had no password for (migration 201).
  await admin
    .from("onboarding_invites")
    .update({ superseded_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("used_at", null)
    .is("superseded_at", null);

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ONBOARDING_INVITE_TTL_MS).toISOString();

  const { error } = await admin.from("onboarding_invites").insert({
    user_id: userId,
    email,
    token,
    expires_at: expiresAt,
    created_by: createdBy ?? null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  // Any fresh link — the scheduled send, Resend, or Copy setup link — means a
  // held-back invite (migration 230) is no longer pending. Clearing it here
  // also stops the cron later minting a newer link that would supersede one
  // an admin already handed over.
  await admin
    .from("users")
    .update({ setup_invite_due_on: null })
    .eq("id", userId)
    .not("setup_invite_due_on", "is", null);

  return { ok: true, token, url: onboardingSetupUrl(siteUrl, token) };
}

export type OnboardingInviteRow = {
  id: string;
  user_id: string;
  email: string;
  token: string;
  expires_at: string;
  used_at: string | null;
  superseded_at: string | null;
};

/** Why a token can't be used — drives the message on the setup page/route. */
export type OnboardingInviteInvalidReason =
  | "not_found"
  | "used"
  | "superseded"
  | "expired";

/**
 * Validate a setup token with the service-role client. Returns the row when
 * usable, or a reason it isn't. Does NOT consume the token — callers mark
 * `used_at` only after the password is set.
 */
export async function validateOnboardingInvite(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  token: string
): Promise<
  | { ok: true; invite: OnboardingInviteRow }
  | { ok: false; reason: OnboardingInviteInvalidReason }
> {
  const { data } = await admin
    .from("onboarding_invites")
    .select("id, user_id, email, token, expires_at, used_at, superseded_at")
    .eq("token", token)
    .maybeSingle();

  const invite = data as OnboardingInviteRow | null;

  if (!invite) return { ok: false, reason: "not_found" };
  if (invite.used_at) return { ok: false, reason: "used" };
  if (invite.superseded_at) return { ok: false, reason: "superseded" };
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, invite };
}
