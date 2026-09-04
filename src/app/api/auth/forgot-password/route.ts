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
const MIN_GAP_MS = 60_000;
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
  // password_reset_requests (migration 202) isn't in the generated Database
  // types yet; the repo convention is to cast for not-yet-typed objects.
  const throttleLog = () =>
    (
      admin as unknown as {
        from: (table: string) => {
          select: (cols: string) => {
            eq: (
              col: string,
              val: string
            ) => {
              gte: (
                col: string,
                val: string
              ) => {
                order: (
                  col: string,
                  opts: { ascending: boolean }
                ) => Promise<{ data: { created_at: string }[] | null }>;
              };
            };
          };
          insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
        };
      }
    ).from("password_reset_requests");

  const sinceHour = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recent } = await throttleLog()
    .select("created_at")
    .eq("email_normalized", email)
    .gte("created_at", sinceHour)
    .order("created_at", { ascending: false });

  const history = recent ?? [];

  // Saying "Link sent" when the throttle stopped us is the bug this route kept
  // producing: someone helping an applicant retries within the minute, is told
  // it worked, and waits for an email that was never sent. Name the wait.
  const throttled = (retryAfterSeconds: number) =>
    NextResponse.json({ ok: true, throttled: true, retryAfterSeconds });

  if (history.length >= HOURLY_CAP) {
    const oldest = new Date(history[history.length - 1].created_at).getTime();
    const freesAt = oldest + 60 * 60 * 1000;
    return throttled(Math.max(1, Math.ceil((freesAt - Date.now()) / 1000)));
  }

  if (history.length > 0) {
    const sinceLast = Date.now() - new Date(history[0].created_at).getTime();
    if (sinceLast < MIN_GAP_MS) {
      return throttled(Math.max(1, Math.ceil((MIN_GAP_MS - sinceLast) / 1000)));
    }
  }

  // Count this attempt before doing any work, so a slow or failing send can't
  // let a caller slip past the limit by retrying.
  await throttleLog().insert({ email_normalized: email });

  // Resolve the account and, crucially, whether it can be signed into at all.
  const account = await lookupAccountByEmail(admin, email);

  if (account.state === "no_account" || !account.userId) return neutral;

  const user = { id: account.userId, first_name: account.firstName };

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
