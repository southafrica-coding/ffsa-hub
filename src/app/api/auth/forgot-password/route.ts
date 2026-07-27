import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Resend } from "resend";
import { resetPasswordEmailHtml } from "@/lib/email/templates/reset-password";

const resend = new Resend(process.env.RESEND_API_KEY?.trim());

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

  // Resolve the account (case-insensitive). first_name lets us greet them.
  const { data: user } = await admin
    .from("users")
    .select("id, first_name")
    .ilike("email", email)
    .maybeSingle();

  if (!user) return neutral;

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
    await resend.emails.send({
      from: `Fire & Fragrance SA <${fromEmail}>`,
      to: email,
      subject: "Reset your FFSA Hub password",
      html: resetPasswordEmailHtml({
        firstName: user.first_name || undefined,
        resetUrl,
      }),
    });
  } catch {
    // Swallow send errors — still respond neutrally and still record the
    // attempt so the throttle holds.
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
