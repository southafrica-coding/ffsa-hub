// FFSA Hub — why can't this person get in?
//
// The admin Users page could show that someone was invited, but not whether
// they can actually sign in. Both blocking states are invisible in
// public.users: a password that was never set (the account is created without
// one at acceptance) and an email address on the suppression list (it bounced,
// so every link we send is silently dropped).
//
// Not being able to see either is what made deleting the account look like the
// only move — and deleting unlinks their application (migration 200). Two bulk
// reads, so the table costs the same to render as before.

import { createAdminClient } from "@/lib/supabase/admin";

export type AccountFlags = {
  /** Cannot sign in: no password has ever been set. */
  needsSetup: boolean;
  /** Their address has bounced before, so no email we send will reach them. */
  emailSuppressed: boolean;
};

export async function getAccountFlags(
  emailsById: Map<string, string | null>
): Promise<Map<string, AccountFlags>> {
  const admin = createAdminClient();
  const flags = new Map<string, AccountFlags>();

  // users_without_password (migration 203) isn't in the generated Database
  // types; the repo convention is to cast for not-yet-typed database objects.
  const { data: noPassword } = await (
    admin as unknown as {
      rpc: (fn: string) => Promise<{ data: unknown; error: unknown }>;
    }
  ).rpc("users_without_password");

  const needsSetup = new Set(
    ((noPassword as { user_id: string }[] | null) ?? []).map((r) => r.user_id)
  );

  const normalized = [...emailsById.values()]
    .filter((e): e is string => Boolean(e))
    .map((e) => e.trim().toLowerCase());

  const suppressed = new Set<string>();
  if (normalized.length > 0) {
    const { data: rows } = await admin
      .from("email_suppressions")
      .select("email_normalized")
      .in("email_normalized", normalized);
    for (const r of (rows ?? []) as { email_normalized: string }[]) {
      suppressed.add(r.email_normalized);
    }
  }

  for (const [id, email] of emailsById) {
    flags.set(id, {
      needsSetup: needsSetup.has(id),
      emailSuppressed: email
        ? suppressed.has(email.trim().toLowerCase())
        : false,
    });
  }

  return flags;
}
