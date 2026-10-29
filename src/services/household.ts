// ────────────────────────────────────────────────────────────
// HOUSEHOLD / FAMILY MEMBERS — data access
// ────────────────────────────────────────────────────────────
// A staff member's spouse / children / dependents live in
// public.household_members (one row per member, migration 153).
//
// Since migration 181 those rows are owned by a HOUSEHOLD, not by a
// user: two spouses who are linked share one household and therefore
// see and edit exactly the same records — whoever fills the family in
// first, the other inherits it. RLS scopes every row to
// current_household_id(), so these queries only ever see / touch the
// caller's own household.
//
// household_members.user_id survives as provenance ("who added this
// row"); it is NOT ownership. Always scope by household_id.

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// The columns a caller may write. Kept in sync with
// HOUSEHOLD_WRITABLE_FIELDS in lib/users/profile-fields.ts.
// household_id / user_id / linked_user_id are deliberately absent —
// they are set from the session here, never from a request body.
export type HouseholdMemberInput = {
  relationship?: string;
  full_name?: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  passport_country?: string | null;
  passport_number?: string | null;
  passport_expiry_date?: string | null;
  is_international?: boolean;
  visa_category?: string | null;
  visa_type?: string | null;
  visa_expiry_date?: string | null;
  health_insurance_provider?: string | null;
  health_insurance_policy_number?: string | null;
  health_insurance_expiry_date?: string | null;
  health_insurance_no_expiry?: boolean | null;
};

// The caller's household id, or null if they have none yet. Read-only —
// use ensureHousehold when a household is required for a write.
export async function getHouseholdId(
  supabase: Client,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("users")
    .select("household_id")
    .eq("id", userId)
    .maybeSingle();
  return data?.household_id ?? null;
}

// The caller's household id, creating one on first use. Idempotent.
export async function ensureHousehold(
  supabase: Client,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc("ensure_household", {
    p_user_id: userId,
  });
  if (error) return null;
  return (data as string) ?? null;
}

// The caller's household row (has_children lives here since migration
// 181 — it is a household fact, so a linked spouse inherits the answer).
export async function getHousehold(supabase: Client, userId: string) {
  const householdId = await getHouseholdId(supabase, userId);
  if (!householdId) return { data: null, error: null };
  return supabase
    .from("households")
    .select("*")
    .eq("id", householdId)
    .maybeSingle();
}

// Answer to "do you have children?" — stored on the household.
export async function setHouseholdHasChildren(
  supabase: Client,
  userId: string,
  hasChildren: boolean | null
) {
  const householdId = await ensureHousehold(supabase, userId);
  if (!householdId) {
    return { error: { message: "Could not resolve your household." } };
  }
  return supabase
    .from("households")
    .update({ has_children: hasChildren })
    .eq("id", householdId);
}

// List the household's members, spouses first then by name.
//
// `excludeLinkedUserId` hides the member row that IS the caller: once a
// spouse has their own Hub account they maintain those details on their
// own profile, so showing them as a family member of themselves is
// confusing. The row is only filtered from this view — never deleted —
// so the other spouse keeps seeing it.
export async function getHouseholdMembers(
  supabase: Client,
  userId: string,
  options: { excludeLinkedUserId?: string } = {}
) {
  const householdId = await getHouseholdId(supabase, userId);
  if (!householdId) return { data: [], error: null };

  let query = supabase
    .from("household_members")
    .select("*")
    .eq("household_id", householdId);

  if (options.excludeLinkedUserId) {
    query = query.or(
      `linked_user_id.is.null,linked_user_id.neq.${options.excludeLinkedUserId}`
    );
  }

  return query
    .order("relationship", { ascending: true })
    .order("full_name", { ascending: true });
}

// Create a member in the caller's household. household_id and user_id
// are set here from the session, never trusted from the request body.
export async function createHouseholdMember(
  supabase: Client,
  userId: string,
  input: HouseholdMemberInput
) {
  const householdId = await ensureHousehold(supabase, userId);
  if (!householdId) {
    return {
      data: null,
      error: { message: "Could not resolve your household." },
    };
  }
  return supabase
    .from("household_members")
    .insert({ ...input, household_id: householdId, user_id: userId })
    .select()
    .single();
}

// Update a member — scoped to the caller's household so an id belonging
// to another household affects no rows (RLS enforces this too).
export async function updateHouseholdMember(
  supabase: Client,
  userId: string,
  id: string,
  input: HouseholdMemberInput
) {
  const householdId = await getHouseholdId(supabase, userId);
  if (!householdId) {
    return {
      data: null,
      error: { message: "Could not resolve your household." },
    };
  }
  return supabase
    .from("household_members")
    .update(input)
    .eq("id", id)
    .eq("household_id", householdId)
    // A member who has their own Hub account maintains their own
    // details there; their spouse can't edit them from here.
    .or(`linked_user_id.is.null,linked_user_id.eq.${userId}`)
    .select()
    .single();
}

// Remove spouse rows the caller added themselves that aren't linked to a Hub
// account. Used only while finishing onboarding, when someone added a
// spouse and then changed their marital status to one without a spouse —
// so stale spouse details aren't kept. Never touches a row someone else
// added or a spouse with their own account.
export async function deleteOwnUnlinkedSpouses(
  supabase: Client,
  userId: string
) {
  const householdId = await getHouseholdId(supabase, userId);
  if (!householdId) return { error: null };
  return supabase
    .from("household_members")
    .delete()
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .eq("relationship", "spouse")
    .is("linked_user_id", null);
}

// Delete a member from the caller's household.
export async function deleteHouseholdMember(
  supabase: Client,
  userId: string,
  id: string
) {
  const householdId = await getHouseholdId(supabase, userId);
  if (!householdId) {
    return { error: { message: "Could not resolve your household." } };
  }
  return supabase
    .from("household_members")
    .delete()
    .eq("id", id)
    .eq("household_id", householdId);
}
