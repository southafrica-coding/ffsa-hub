import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validatePassword } from "@/lib/auth/password";
import { validateOnboardingInvite } from "@/lib/auth/onboarding-invite";

// Public endpoint hit from /setup/<token>. Validates the app-controlled
// 30-day onboarding token (migration 158), sets the user's password
// server-side (no session needed — mirrors /api/public/signup), and
// consumes the token. The client then signs in and finishes onboarding.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { token, password } = body as { token?: string; password?: string };

  if (!token || !password) {
    return NextResponse.json(
      { error: "token and password are required" },
      { status: 400 }
    );
  }

  const pwError = validatePassword(password);
  if (pwError) {
    return NextResponse.json({ error: pwError }, { status: 400 });
  }

  const adminSupabase = createAdminClient();

  const result = await validateOnboardingInvite(adminSupabase, token);
  if (!result.ok) {
    const message =
      result.reason === "expired"
        ? "This setup link has expired. Ask a super admin to resend your invite."
        : result.reason === "used"
        ? "This setup link has already been used. Try logging in instead."
        : "This setup link is no longer valid. Ask a super admin to resend your invite.";
    return NextResponse.json({ error: message }, { status: 410 });
  }

  const { invite } = result;

  // Set the password on the existing auth user (created at acceptance /
  // invite time). email_confirm stays true so they can sign in immediately.
  const { error: updateError } =
    await adminSupabase.auth.admin.updateUserById(invite.user_id, {
      password,
      email_confirm: true,
    });

  if (updateError) {
    return NextResponse.json(
      { error: `Failed to set password: ${updateError.message}` },
      { status: 500 }
    );
  }

  // Consume the token (single-use). onboarding_invites isn't in the
  // generated Database types yet — cast per repo convention.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminSupabase as any)
    .from("onboarding_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("id", invite.id);

  // Household match (migration 181): if a Hub member already entered this
  // person as their spouse using this email, flag the household as a PENDING
  // match. Nothing is shared until they confirm it on their next sign-in —
  // then they inherit the family and skip the spouse/children questions.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminSupabase as any).rpc("link_household_on_signup", {
      p_user_id: invite.user_id,
    });
  } catch {
    // Non-fatal — they simply get their own household.
  }

  await adminSupabase.from("audit_logs").insert({
    user_id: invite.user_id,
    action: "onboarding_setup",
    resource_type: "users",
    resource_id: invite.user_id,
    changes: { email: invite.email, source: "onboarding_invite_token" },
  });

  // Email is returned so the client can sign in without re-typing it.
  return NextResponse.json({ success: true, email: invite.email });
}
