import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resetPasswordEmailHtml } from "@/lib/email/templates/reset-password";
import { getResend } from "@/lib/email/resend";
import { lookupAccountByEmail } from "@/lib/auth/account-state";
import { sendSetupLink } from "@/lib/auth/send-setup-link";

// Throttle: at most one email per minute, and 3 per hour, per account.
// Backed by audit_logs so it survives across serverless invocations without
// a new table. This blunts inbox-bombing of a specific person.
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

  // Resolve the account and, crucially, whether it can be signed into at all.
  const account = await lookupAccountByEmail(admin, email);

  if (account.state === "no_account" || !account.userId) return neutral;

  const user = { id: account.userId, first_name: account.firstName };

  // Throttle from the request history we keep in audit_logs.
  const sinceHour = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recent } = await admin
    .from("audit_logs")
    .select("created_at")
    .eq("user_id", user.id)
    .eq("action", "password_reset_requested")
    .gte("created_at", sinceHour)
    .order("created_at", { ascending: false });

  const history = recent ?? [];
  if (history.length >= HOURLY_CAP) return neutral;
  if (
    history.length > 0 &&
    Date.now() - new Date(history[0].created_at).getTime() < MIN_GAP_MS
  ) {
    return neutral;
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
        : { via: "forgot_password", error: setupResult.error },
    });

    // Count against the same throttle as a reset, so this branch can't be
    // used to inbox-bomb someone either.
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

  const fromEmail = (process.env.RESEND_FROM_EMAIL || "noreply@ffsahub.com").trim();
  try {
    await getResend().emails.send({
      from: `Fire & Fragrance SA <${fromEmail}>`,
      to: email,
      subject: "Reset your FFSA Hub password",
      html: resetPasswordEmailHtml({
        firstName: user.first_name || undefined,
        resetUrl,
      }),
    });
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
