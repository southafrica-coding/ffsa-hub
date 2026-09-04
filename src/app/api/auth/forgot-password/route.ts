import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resetPasswordEmailHtml } from "@/lib/email/templates/reset-password";
import { sendTransactional } from "@/lib/email/send-transactional";
import { lookupAccountByEmail } from "@/lib/auth/account-state";
import { sendSetupLink } from "@/lib/auth/send-setup-link";

// Throttle: at most one email per minute, and 3 per hour, per ADDRESS.
// Keyed on the normalized email (migration 202), not on a resolved user, for
// two reasons: it protects addresses that have no account, and — because the
// limit no longer depends on whether an account exists — we can tell the
// person they have been throttled instead of pretending we sent something.
const MIN_GAP_SECONDS = 60;
const HOURLY_CAP = 3;

export async function POST(request: Request) {
  let email: string | undefined;
  try {
    const body = await request.json();
    if (typeof body?.email === "string") {
      email = body.email.trim().toLowerCase();
    }
  } catch {
    // ignore malformed bodies
  }

  // ALWAYS respond the same way, whatever happens below. The client never
  // learns whether an account exists — no account enumeration.
  const neutral = NextResponse.json({ ok: true });

  if (!email || !email.includes("@")) return neutral;

  const admin = createAdminClient();

  // Throttle FIRST, before we know whether this address has an account, so the
  // answer below depends only on what this address has just done. That is what
  // makes it safe to report: "you asked a moment ago" reveals nothing about
  // whether the address is registered, because an unregistered one is told the
  // same thing at the same moment.
  //
  // Deciding and recording happen in one statement (migration 204). Doing it
  // as read-then-insert let two requests a few milliseconds apart both pass
  // the check before either row was visible, and send twice.
  //
  // claim_password_reset_slot isn't in the generated Database types yet; the
  // repo convention is to cast for not-yet-typed database objects.
  const claimSlot = () =>
    (
      admin as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>
        ) => Promise<{
          data: { allowed: boolean; retry_after_seconds: number }[] | null;
          error: unknown;
        }>;
      }
    ).rpc("claim_password_reset_slot", {
      p_email: email,
      p_min_gap_seconds: MIN_GAP_SECONDS,
      p_hourly_cap: HOURLY_CAP,
    });

  // One retry. The failures worth surviving here are transient — a cold start
  // establishing its first connection, a pool briefly exhausted — and they
  // resolve in milliseconds. Retrying once turns most of them into a correct
  // answer instead of a silent bypass; retrying more would just make a person
  // wait on a database that is genuinely unwell.
  let { data: slotData, error: slotError } = await claimSlot();
  if (slotError) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    ({ data: slotData, error: slotError } = await claimSlot());
  }

  const slot = slotData?.[0];

  // Fail open when the throttle cannot be reached: refusing to send would
  // strand exactly the people this route exists for, and the cap is a
  // courtesy, not a security control.
  //
  // But a bypass must never again be something we can only guess at after the
  // fact. Record it — below, once an account is resolved, because a bypass
  // only means anything if an email actually goes out, and nothing is sent to
  // an address with no account.
  const throttleDegraded = Boolean(slotError) || !slot;

  if (!throttleDegraded && slot && !slot.allowed) {
    // Saying "Link sent" when the throttle stopped us is the bug this route
    // kept producing: someone helping an applicant retries within the minute,
    // is told it worked, and waits for an email that was never sent.
    return NextResponse.json({
      ok: true,
      throttled: true,
      retryAfterSeconds: slot.retry_after_seconds,
    });
  }

  // Resolve the account and, crucially, whether it can be signed into at all.
  const account = await lookupAccountByEmail(admin, email);

  if (account.state === "no_account" || !account.userId) return neutral;

  const user = { id: account.userId, first_name: account.firstName };

  // The throttle was unreachable and we are about to send anyway. This is the
  // only path where failing open has a visible consequence, so it is the only
  // one worth a row.
  if (throttleDegraded) {
    await admin.from("audit_logs").insert({
      user_id: user.id,
      action: "password_reset_throttle_unavailable",
      resource_type: "auth",
      resource_id: user.id,
      changes: {
        note: "Rate limit could not be checked; the email was sent anyway.",
        error:
          slotError instanceof Error
            ? slotError.message
            : slotError
            ? String(slotError)
            : "no slot returned",
      },
    });
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";

  // Someone who has never set a password can't be sent a *reset* — Supabase
  // refuses to issue a recovery link for an unconfirmed address, and this
  // route used to swallow that error and return the same cheerful neutral
  // response. That is the dead end accepted applicants kept hitting: the
  // only visible recovery affordance did nothing, silently. Send them the
  // setup link they actually need instead.
  if (account.state === "needs_setup") {
    const setupResult = await sendSetupLink(admin, {
      userId: user.id,
      email,
      firstName: user.first_name,
      reason:
        "They asked to reset a password on an account that has never had one, so they were sent a setup link.",
    });

    await admin.from("audit_logs").insert({
      user_id: user.id,
      action: setupResult.ok
        ? "setup_link_sent"
        : "setup_link_failed",
      resource_type: "auth",
      resource_id: user.id,
      changes: setupResult.ok
        ? { via: "forgot_password" }
        : {
            via: "forgot_password",
            error: setupResult.error,
            // A suppressed address can never be reached by email again, so
            // this is not a transient failure to retry — it is the case an
            // admin has to resolve with a copied link. Flag it so the Users
            // table can show it rather than leaving the person invisible.
            suppressed: setupResult.suppressed ?? false,
          },
    });

    // The throttle itself is now keyed on the address (migration 202); this
    // row stays for the per-account audit trail admins read.
    await admin.from("audit_logs").insert({
      user_id: user.id,
      action: "password_reset_requested",
      resource_type: "auth",
      resource_id: user.id,
      changes: null,
    });

    return neutral;
  }

  // Generate the recovery link ourselves and email it via Resend, exactly like
  // invites — so it's branded and reliably delivered, NOT sent through
  // Supabase's rate-limited default mailer.
  const { data: linkData, error: linkError } =
    await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${siteUrl}/auth/confirm?flow=recovery` },
    });

  if (linkError || !linkData?.properties?.hashed_token) {
    // Still neutral to the browser (no account enumeration), but no longer
    // invisible to us — a failure here means a real person got nothing.
    await admin.from("audit_logs").insert({
      user_id: user.id,
      action: "password_reset_failed",
      resource_type: "auth",
      resource_id: user.id,
      changes: { error: linkError?.message ?? "no recovery token returned" },
    });
    return neutral;
  }

  // Do NOT email Supabase's raw action_link (the /auth/v1/verify URL). That
  // link is a one-time GET — email scanners and clients that pre-fetch links
  // (Gmail, corporate AV) consume the recovery token before the user clicks,
  // producing otp_expired. Instead, build a link to OUR /auth/confirm page
  // carrying the token_hash; the OTP is only verified when the page's JS runs
  // verifyOtp, which scanners don't trigger.
  const resetUrl = `${siteUrl}/auth/confirm?flow=recovery&type=recovery&token_hash=${encodeURIComponent(
    linkData.properties.hashed_token
  )}`;

  // Send through sendTransactional, not raw Resend. The raw path wrote no
  // ledger row (so a reset that never arrived was invisible — there was no
  // record to check) and skipped the suppression list (so a previously
  // bounced address was handed to Resend and silently dropped). Both are how
  // "I clicked forgot password and got nothing" stayed unexplainable.
  try {
    const sendResult = await sendTransactional({
      to: email,
      subject: "Reset your FFSA Hub password",
      html: resetPasswordEmailHtml({
        firstName: user.first_name || undefined,
        resetUrl,
      }),
      category: "password_reset",
      reason: "They asked to reset their FFSA Hub password.",
    });

    if (!sendResult.ok) {
      await admin.from("audit_logs").insert({
        user_id: user.id,
        action: "password_reset_failed",
        resource_type: "auth",
        resource_id: user.id,
        changes: {
          error: sendResult.error,
          suppressed: sendResult.suppressed,
        },
      });
    }
  } catch (err) {
    // Still neutral to the browser, but recorded: a swallowed send failure
    // here is indistinguishable from success to the person waiting.
    await admin.from("audit_logs").insert({
      user_id: user.id,
      action: "password_reset_failed",
      resource_type: "auth",
      resource_id: user.id,
      changes: { error: err instanceof Error ? err.message : "send failed" },
    });
  }

  await admin.from("audit_logs").insert({
    user_id: user.id,
    action: "password_reset_requested",
    resource_type: "auth",
    resource_id: user.id,
    changes: null,
  });

  return neutral;
}
