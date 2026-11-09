import type { Database, TablesUpdate } from "@/types/database";
type UserUpdate = TablesUpdate<"users">;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export async function getCurrentUser(supabase: Client) {
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return { data: null, error: null };

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", authUser.id)
    .single();

  if (error) return { data: null, error };

  // Load roles
  const { data: roles } = await supabase
    .from("user_roles")
    .select("*, roles(*)")
    .eq("user_id", authUser.id);

  return {
    data: {
      ...data,
      auth_user: authUser,
      user_roles: roles ?? [],
    },
    error: null,
  };
}

export async function getUsers(
  supabase: Client,
  options?: { search?: string; limit?: number; offset?: number }
) {
  let query = supabase
    .from("users")
    .select("*, user_roles!user_roles_user_id_fkey(*, roles(*))", {
      count: "exact",
    })
    .order("created_at", { ascending: false });

  if (options?.search) {
    const term = `%${options.search}%`;
    query = query.or(
      `display_name.ilike.${term},first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term}`
    );
  }

  if (options?.limit) {
    const from = options.offset ?? 0;
    query = query.range(from, from + options.limit - 1);
  }

  return query;
}

export async function getUserById(supabase: Client, id: string) {
  return supabase
    .from("users")
    .select("*, user_roles!user_roles_user_id_fkey(*, roles(*))")
    .eq("id", id)
    .single();
}

// avatar_url, display_name and is_active are outside migration 315's GRANT.
// Callers must pass the service-role client (the avatar route does).
export async function updateUser(
  supabase: Client,
  id: string,
  data: {
    display_name?: string | null;
    avatar_url?: string | null;
    is_active?: boolean;
  }
) {
  return supabase.from("users").update(data).eq("id", id).select().single();
}

export async function updateUserProfile(
  supabase: Client,
  id: string,
  data: Partial<UserUpdate>
) {
  return supabase.from("users").update(data).eq("id", id).select().single();
}

// Not wired (see src/lib/users/auth-signins.ts). last_sign_in_at is outside
// migration 315's GRANT, so this must not be called with the user client —
// authenticated UPDATE of that column is 42501. Keep it on the service role
// if it is ever connected.
export async function updateLastSignIn(supabase: Client, userId: string) {
  return supabase
    .from("users")
    .update({ last_sign_in_at: new Date().toISOString(), accepted_at: new Date().toISOString() })
    .eq("id", userId)
    .is("accepted_at", null)
    .select()
    .single();
}

/** Mark onboarding as complete — activates the account with base self_service access. */
export async function completeOnboarding(supabase: Client, userId: string) {
  return supabase
    .from("users")
    .update({
      accepted_at: new Date().toISOString(),
      status: "active",
    })
    .eq("id", userId)
    .select()
    .single();
}

/**
 * Approve a user on the service-role client: status active, and job_title
 * when the caller sent one.
 *
 * One UPDATE so a failure cannot commit the approval and then error on the
 * title (or the other way around). Do not pass the user client. The route
 * must already have confirmed an unscoped admin via is_admin().
 */
export async function activateApprovedUser(
  admin: Client,
  userId: string,
  jobTitle?: string | null
) {
  const update: Record<string, unknown> = { status: "active" };
  if (jobTitle !== undefined) update.job_title = jobTitle;
  // Only a pending_approval row changes. Zero rows means it was already
  // approved or holds another status — the caller returns 409.
  return admin
    .from("users")
    .update(update)
    .eq("id", userId)
    .eq("status", "pending_approval")
    .select()
    .maybeSingle();
}

/**
 * A user's health-insurance policy history (current + past), most recently
 * recorded first. Each renewal is snapshotted into user_insurance_policies by
 * a DB trigger (migration 130); RLS lets a user read their own rows and admins
 * read anyone's.
 */
export async function getInsurancePolicies(supabase: Client, userId: string) {
  return supabase
    .from("user_insurance_policies")
    .select("id, provider, policy_number, expiry_date, recorded_at")
    .eq("user_id", userId)
    .order("recorded_at", { ascending: false });
}

/**
 * Delete a single insurance policy history row by id. Callers are
 * responsible for the ownership + "only a duplicate, never the current /
 * last" checks — RLS on user_insurance_policies is SELECT-only, so this
 * must run with the admin (service-role) client.
 */
export async function deleteInsurancePolicy(supabase: Client, policyId: string) {
  return supabase.from("user_insurance_policies").delete().eq("id", policyId);
}

/** Count users currently awaiting approval. */
export async function getPendingApprovalCount(supabase: Client) {
  const { count } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending_approval");
  return count ?? 0;
}
