// FFSA Hub — "can this person actually sign in?", answered honestly.
//
// An accepted applicant's auth user is created with email_confirm: true and
// NO password (accept-application), then mailed a 30-day /setup link. That
// left three routes guessing at account state and all three guessed wrong:
// resend-invite read email_confirmed_at as "already activated" and refused
// to help; forgot-password asked for a recovery link, which Supabase denies
// for an unconfirmed address, and swallowed the error; /join said the
// account already exists. Four locked doors, none of them saying so.
//
// Everything routes through here now, so the answer is the same everywhere.

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * - `no_account`  — nothing to recover; caller should stay neutral.
 * - `needs_setup` — the account exists but has never had a password. The fix
 *                   is a fresh /setup link, NOT a password reset.
 * - `active`      — has a password; ordinary reset flow applies.
 */
export type AccountState = "no_account" | "needs_setup" | "active";

export type AccountLookup = {
  state: AccountState;
  userId: string | null;
  email: string | null;
  firstName: string | null;
};

const NO_ACCOUNT: AccountLookup = {
  state: "no_account",
  userId: null,
  email: null,
  firstName: null,
};

type AdminClient = ReturnType<typeof createAdminClient>;

/** Does this auth user have a usable password? (migration 199) */
export async function userHasPassword(
  admin: AdminClient,
  userId: string
): Promise<boolean> {
  // user_has_password (migration 199) isn't in the generated Database types
  // yet; the repo convention is to cast for not-yet-typed database objects.
  const { data, error } = await (
    admin as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: unknown }>;
    }
  ).rpc("user_has_password", { p_user_id: userId });

  if (error) {
    // Fail closed: treating an unknown account as "active" only costs the
    // caller a normal password-reset attempt, whereas guessing "needs_setup"
    // would hand out a setup link that overwrites a real password.
    return true;
  }

  return data === true;
}

/** Resolve an email address to its account state. Case-insensitive. */
export async function lookupAccountByEmail(
  admin: AdminClient,
  rawEmail: string
): Promise<AccountLookup> {
  const email = rawEmail.trim().toLowerCase();
  if (!email.includes("@")) return NO_ACCOUNT;

  const { data } = await admin
    .from("users")
    .select("id, email, first_name")
    .ilike("email", email)
    .maybeSingle();

  const user = data as
    | { id: string; email: string | null; first_name: string | null }
    | null;

  if (!user) return NO_ACCOUNT;

  const hasPassword = await userHasPassword(admin, user.id);

  return {
    state: hasPassword ? "active" : "needs_setup",
    userId: user.id,
    email: user.email ?? email,
    firstName: user.first_name,
  };
}

/** Same question, when the caller already knows the user id. */
export async function lookupAccountByUserId(
  admin: AdminClient,
  userId: string
): Promise<AccountLookup> {
  const { data } = await admin
    .from("users")
    .select("id, email, first_name")
    .eq("id", userId)
    .maybeSingle();

  const user = data as
    | { id: string; email: string | null; first_name: string | null }
    | null;

  if (!user) return NO_ACCOUNT;

  const hasPassword = await userHasPassword(admin, user.id);

  return {
    state: hasPassword ? "active" : "needs_setup",
    userId: user.id,
    email: user.email,
    firstName: user.first_name,
  };
}
