import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  looksLikeRecoveryCode,
  selectRedeemableCode,
} from "@/lib/auth/recovery-codes";
import {
  deleteRecoveryCodes,
  logTwoFactorEvent,
  removeAllFactors,
  tooManyRecentFailures,
} from "@/lib/auth/two-factor";

const FAILED = "2fa_recovery_failed";

/**
 * Redeems a recovery code for a user who is stuck at the 2FA challenge because
 * they've lost their authenticator.
 *
 * A recovery code cannot mint a TOTP-verified session — only the authenticator
 * can do that. So redeeming one instead REMOVES the lost authenticator: the
 * vaulted secret is destroyed, the session drops to "no factor enrolled", and
 * the enrolment gate immediately walks the user through setting up a new
 * device. Net effect for the user is "I got back in"; net effect for security
 * is that the lost device is dead and one single-use code was spent.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // A valid password-verified session is required — this endpoint is reachable
  // only from the challenge screen, never anonymously.
  if (!user) {
    return NextResponse.json(
      { error: "Your sign-in session expired. Please sign in again." },
      { status: 401 }
    );
  }

  const { data: aal } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel !== "aal2") {
    return NextResponse.json(
      { error: "There is no authenticator to recover on this account." },
      { status: 400 }
    );
  }

  if (await tooManyRecentFailures(user.id, FAILED)) {
    return NextResponse.json(
      {
        error:
          "Too many incorrect recovery codes. Please wait 15 minutes before trying again.",
      },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const submitted = typeof body?.code === "string" ? body.code : "";
  // The code itself is never logged, here or anywhere downstream.
  if (!looksLikeRecoveryCode(submitted)) {
    await logTwoFactorEvent(user.id, FAILED);
    return NextResponse.json(
      { error: "That doesn't look like a recovery code." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data: rows, error: readError } = await admin
    .from("user_recovery_codes")
    .select("id, code_hash, used_at")
    .eq("user_id", user.id);

  if (readError) {
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }

  // An already-used code is rejected exactly like an unknown one — the user
  // learns nothing about which of their codes have been spent.
  const match = selectRedeemableCode(rows ?? [], submitted);
  if (!match) {
    await logTwoFactorEvent(user.id, FAILED);
    return NextResponse.json(
      { error: "That recovery code isn't valid. Each code works only once." },
      { status: 400 }
    );
  }

  // Spend the code before acting on it, so a failure downstream can't leave it
  // reusable.
  const { error: spendError } = await admin
    .from("user_recovery_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", match.id)
    .is("used_at", null);
  if (spendError) {
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }

  await removeAllFactors(user.id);
  // The remaining codes belonged to the authenticator that's now gone; the new
  // enrolment issues a fresh set.
  await deleteRecoveryCodes(user.id);
  await logTwoFactorEvent(user.id, "2fa_recovery_code_used");

  return NextResponse.json({ ok: true });
}
