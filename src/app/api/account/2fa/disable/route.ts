import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  deleteRecoveryCodes,
  logTwoFactorEvent,
  removeAllFactors,
  tooManyRecentFailures,
  verifyPassword,
} from "@/lib/auth/two-factor";

const FAILED = "2fa_disable_failed";

/**
 * Turns two-factor authentication off.
 *
 * Strong re-authentication is required on both axes: the session must already
 * have satisfied a live authenticator code (aal2), AND the current password
 * must be re-entered here. A stolen, still-warm session cannot silently strip
 * the account's second factor.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
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

  if (await tooManyRecentFailures(user.id, FAILED)) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait 15 minutes and try again." },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || !(await verifyPassword(user.email, password))) {
    await logTwoFactorEvent(user.id, FAILED);
    return NextResponse.json(
      { error: "That password is incorrect." },
      { status: 400 }
    );
  }

  // Deleting the factor destroys the vaulted secret with it, so the old QR
  // code and any authenticator still holding it are permanently dead.
  await removeAllFactors(user.id);
  await deleteRecoveryCodes(user.id);
  await logTwoFactorEvent(user.id, "2fa_disabled");

  return NextResponse.json({ ok: true });
}
