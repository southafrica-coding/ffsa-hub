// ============================================================
// Store — email-link sign-in for buyers
// ============================================================
// Buyers aren't Hub users. They sign in with a one-time link: we ask
// Supabase for a magic-link token (admin.generateLink) and email our own
// link to /store/auth/confirm, where the browser verifies it. Verifying in
// the browser (not on GET) means a mail scanner pre-fetching the link
// can't burn the token — the same reason /auth/confirm does it.
//
// The auth user is created only here, and only for an email that already
// has a Store order or entitlement, so the form can't be used to mint
// accounts. A buyer's auth user gets NO users row and NO roles.
// ============================================================

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl } from "./flags";

export async function makeBuyerSignInLink(email: string, next = "/store/library"): Promise<string | null> {
  const admin = createAdminClient();
  const address = email.trim().toLowerCase();

  // Ensure an auth user exists. "Already registered" is the normal case.
  const created = await admin.auth.admin.createUser({ email: address, email_confirm: true });
  if (created.error && !/already|registered|exists/i.test(created.error.message)) {
    console.error("[store/sign-in] createUser failed:", created.error.message);
    return null;
  }

  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: address });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error("[store/sign-in] generateLink failed:", error?.message);
    return null;
  }
  const q = new URLSearchParams({ token_hash: tokenHash, type: "magiclink", next });
  return `${appUrl()}/store/auth/confirm?${q.toString()}`;
}
