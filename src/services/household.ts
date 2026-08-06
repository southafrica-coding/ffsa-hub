// ────────────────────────────────────────────────────────────
// HOUSEHOLD / FAMILY MEMBERS — data access
// ────────────────────────────────────────────────────────────
// A staff member's spouse / children / dependents live in
// public.household_members (one row per member, migration 153). RLS
// scopes every row to its owning user_id, so these queries only ever
// see / touch the caller's own family records.

type Client = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// The columns a caller may write. Kept in sync with
// HOUSEHOLD_WRITABLE_FIELDS in lib/users/profile-fields.ts.
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
};

// List a user's household members, spouses first then by name.
export async function getHouseholdMembers(supabase: Client, userId: string) {
  return supabase
    .from("household_members")
    .select("*")
    .eq("user_id", userId)
    .order("relationship", { ascending: true })
    .order("full_name", { ascending: true });
}

// Create a member owned by userId. user_id is set here from the session,
// never trusted from the request body.
export async function createHouseholdMember(
  supabase: Client,
  userId: string,
  input: HouseholdMemberInput
) {
  return supabase
    .from("household_members")
    .insert({ ...input, user_id: userId })
    .select()
    .single();
}

// Update a member — scoped to the caller so an id belonging to someone
// else affects no rows (RLS enforces this too).
export async function updateHouseholdMember(
  supabase: Client,
  userId: string,
  id: string,
  input: HouseholdMemberInput
) {
  return supabase
    .from("household_members")
    .update(input)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();
}

// Delete a member owned by the caller.
export async function deleteHouseholdMember(
  supabase: Client,
  userId: string,
  id: string
) {
  return supabase
    .from("household_members")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
}
