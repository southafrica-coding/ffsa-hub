// ────────────────────────────────────────────────────────────
// Phone push: data access (device_push_tokens, push opt-outs)
// ────────────────────────────────────────────────────────────
// Plain query builders in the services style: each takes a client and
// returns Supabase's { data, error }. Generated types predate migration 288,
// so the client is untyped here (repo convention for new tables).
// ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type DeviceRow = {
  id: string;
  user_id: string;
  expo_token: string;
};

// ── Devices ──────────────────────────────────────────────────

/**
 * Register (or re-register) a phone for a user. The token is unique, so a
 * phone that moves to another person (sign out, someone else signs in) is
 * re-assigned to them and un-revoked. Needs the service-role client for
 * that re-assignment: the previous owner's row is invisible under RLS.
 */
export async function upsertDevice(
  admin: Client,
  row: {
    user_id: string;
    expo_token: string;
    platform: "ios" | "android";
    app_version: string;
    device_name: string | null;
  }
) {
  return admin
    .from("device_push_tokens")
    .upsert(
      { ...row, last_seen_at: new Date().toISOString(), revoked_at: null },
      { onConflict: "expo_token" }
    )
    .select("id")
    .single();
}

/** Revoke one of the caller's own phones. RLS limits this to own rows. */
export async function revokeOwnDevice(supabase: Client, userId: string, expoToken: string) {
  return supabase
    .from("device_push_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("expo_token", expoToken)
    .is("revoked_at", null)
    .select("id");
}

/** Live phones for a set of users (sender, service role). */
export async function getLiveDevices(admin: Client, userIds: string[]) {
  return admin
    .from("device_push_tokens")
    .select("id, user_id, expo_token")
    .in("user_id", userIds)
    .is("revoked_at", null);
}

/** Expo said these tokens no longer reach a phone (app uninstalled). */
export async function revokeTokens(admin: Client, expoTokens: string[]) {
  return admin
    .from("device_push_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .in("expo_token", expoTokens)
    .is("revoked_at", null);
}

// ── Opt-outs ────────────────────────────────────────────────

export async function getOwnPushMutes(supabase: Client, userId: string) {
  return supabase
    .from("notification_preferences")
    .select("push_muted_kinds")
    .eq("user_id", userId)
    .maybeSingle();
}

/** Upsert only the push column, so the Slack mutes on the same row stay. */
export async function setOwnPushMutes(supabase: Client, userId: string, muted: string[]) {
  return supabase
    .from("notification_preferences")
    .upsert({ user_id: userId, push_muted_kinds: muted }, { onConflict: "user_id" });
}

export async function getPushMutesFor(admin: Client, userIds: string[]) {
  return admin
    .from("notification_preferences")
    .select("user_id, push_muted_kinds")
    .in("user_id", userIds);
}

export async function getActiveUserIds(admin: Client, userIds: string[]) {
  return admin.from("users").select("id").in("id", userIds).eq("is_active", true);
}
