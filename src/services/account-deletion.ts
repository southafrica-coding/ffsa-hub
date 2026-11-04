// ────────────────────────────────────────────────────────────
// Account deletion requests (migration 289)
// ────────────────────────────────────────────────────────────
// Pure data access for /api/account/deletion-request. Every function that
// touches account_deletion_requests runs on the CALLER's RLS client, so a
// person only ever sees and changes their own rows. The admin recipient
// lookup is the one exception and takes the service-role client.
//
// Migration 289 may not be applied yet. Callers check isMissingTableError()
// on the returned error and fall back to email-only handling.
// ────────────────────────────────────────────────────────────

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const DELETION_REQUEST_COLUMNS = "id, status, reason, source, requested_at, cancelled_at";

export type DeletionRequestRow = {
  id: string;
  status: "open" | "cancelled" | "completed" | "declined";
  reason: string | null;
  source: "app" | "web";
  requested_at: string;
  cancelled_at: string | null;
};

// ── Errors ──────────────────────────────────────────────────

/**
 * True when PostgREST says the table doesn't exist: Postgres 42P01
 * ("relation does not exist") or PostgREST's schema-cache miss PGRST205.
 */
export function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === "42P01" || e.code === "PGRST205") return true;
  const message = typeof e.message === "string" ? e.message : "";
  return /account_deletion_requests/.test(message) && /does not exist|could not find the table/i.test(message);
}

/** True for a unique-index clash: someone already has an open request. */
export function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === "23505";
}

// ── The caller's own request ────────────────────────────────

/** The caller's open request, or null. */
export async function getOpenDeletionRequest(supabase: Client, userId: string) {
  return supabase
    .from("account_deletion_requests")
    .select(DELETION_REQUEST_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "open")
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function insertDeletionRequest(
  supabase: Client,
  row: {
    user_id: string;
    email: string | null;
    full_name: string | null;
    reason: string | null;
    source: "app" | "web";
  }
) {
  return supabase
    .from("account_deletion_requests")
    .insert({ ...row, status: "open" })
    .select(DELETION_REQUEST_COLUMNS)
    .single();
}

/** Moves the caller's open request to cancelled. Returns the updated row. */
export async function cancelDeletionRequest(supabase: Client, userId: string, id: string) {
  return supabase
    .from("account_deletion_requests")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", "open")
    .select(DELETION_REQUEST_COLUMNS)
    .maybeSingle();
}

// ── People ──────────────────────────────────────────────────

/** The caller's own users row (RLS: a user reads their own row). */
export async function getRequesterProfile(supabase: Client, userId: string) {
  return supabase
    .from("users")
    .select("email, first_name, last_name, display_name")
    .eq("id", userId)
    .maybeSingle();
}

/**
 * user_ids holding super_admin or admin: the people who can open Users and
 * run delete-user. Service-role client (reads other people's roles).
 */
export async function getUserAdminIds(admin: Client) {
  return admin
    .from("user_roles")
    .select("user_id, roles!inner(name)")
    .in("roles.name", ["super_admin", "admin"]);
}

/** Emails of the given users that are still active. Service-role client. */
export async function getActiveUserEmails(admin: Client, userIds: string[]) {
  return admin.from("users").select("id, email").in("id", userIds).eq("is_active", true);
}
