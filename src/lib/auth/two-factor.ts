import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Server-side two-factor helpers that need elevated access. Node runtime only —
 * it reaches for the service-role key. The pure state logic lives in
 * ./two-factor-state.
 *
 * The TOTP secret lives in Supabase Auth's own vault — enrolment, the
 * otpauth:// URI and every code verification happen through supabase.auth.mfa.*
 * against Supabase's servers. Nothing in this file ever sees, stores or logs a
 * secret or a submitted code.
 */

export * from "./two-factor-state";

/**
 * Verifies a password WITHOUT touching the caller's cookies — used to
 * re-authenticate before destructive security changes. The throwaway client
 * never persists a session, so a successful check cannot hand anyone a token.
 */
export async function verifyPassword(
  email: string,
  password: string
): Promise<boolean> {
  const client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (!error) await client.auth.signOut().catch(() => {});
  return !error;
}

/** Every TOTP factor on the account, verified or half-enrolled. */
export async function listFactorIds(userId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin.auth.admin.getUserById(userId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data?.user as any)?.factors ?? []).map((f: { id: string }) => f.id);
}

/**
 * Permanently removes every authenticator from the account. Supabase deletes
 * the vaulted secret with the factor, so the old QR code can never be used
 * again — there is nothing left for it to verify against.
 */
export async function removeAllFactors(userId: string): Promise<void> {
  const admin = createAdminClient();
  const ids = await listFactorIds(userId);
  for (const id of ids) {
    await admin.auth.admin.mfa.deleteFactor({ id, userId });
  }
}

/** Drops every recovery code the user holds, used or not. */
export async function deleteRecoveryCodes(userId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("user_recovery_codes").delete().eq("user_id", userId);
}

/**
 * Durable rate limiting, counted out of audit_logs so it survives the
 * stateless serverless runtime (an in-memory counter would reset on every cold
 * start, which is no limit at all).
 */
export async function tooManyRecentFailures(
  userId: string,
  action: string,
  limit = 5,
  windowMs = 15 * 60 * 1000
): Promise<boolean> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("resource_id", userId)
    .eq("action", action)
    .gte("created_at", since);
  return (count ?? 0) >= limit;
}

/** Records a 2FA security event. Never receives a code or a secret. */
export async function logTwoFactorEvent(
  userId: string,
  action: string
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("audit_logs")
    .insert({
      user_id: userId,
      action,
      resource_type: "auth",
      resource_id: userId,
      changes: null,
    })
    .then(
      () => undefined,
      () => undefined
    );
}
