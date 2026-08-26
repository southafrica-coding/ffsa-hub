import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
} from "@/lib/auth/recovery-codes";
import { deleteRecoveryCodes, logTwoFactorEvent } from "@/lib/auth/two-factor";

/**
 * Issues a fresh set of recovery codes and returns the plaintext ONCE. Every
 * previous code is destroyed in the same operation.
 *
 * Requires a session that has already satisfied TOTP (aal2) — which covers both
 * moments this is called: immediately after a successful enrolment, and a
 * deliberate regenerate from Account → Security. A password-only session can
 * never mint codes.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: aal } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") {
    return NextResponse.json(
      { error: "Confirm a code from your authenticator app first." },
      { status: 403 }
    );
  }

  const codes = generateRecoveryCodes();
  const admin = createAdminClient();

  // Old codes die first, so a crash between the two steps leaves the user with
  // no codes (recoverable — they can regenerate) rather than two live sets.
  await deleteRecoveryCodes(user.id);

  const { error } = await admin.from("user_recovery_codes").insert(
    codes.map((code) => ({
      user_id: user.id,
      code_hash: hashRecoveryCode(code),
    }))
  );
  if (error) {
    return NextResponse.json(
      { error: "Could not save your recovery codes. Please try again." },
      { status: 500 }
    );
  }

  await logTwoFactorEvent(user.id, "2fa_recovery_codes_generated");

  // The only time these strings ever leave the server.
  return NextResponse.json({ codes });
}
