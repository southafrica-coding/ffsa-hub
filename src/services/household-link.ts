// ────────────────────────────────────────────────────────────
// HOUSEHOLD LINKING — pending-match state (server only)
// ────────────────────────────────────────────────────────────
// When someone signs up with the email their spouse already entered on
// a spouse record, migration 181 sets users.pending_household_id. That
// is a PENDING match only: household_id stays NULL, so RLS shows the
// new user nothing of that household until they confirm it is theirs.
//
// To render the confirmation we need the other household's owner name —
// which the pending user cannot read yet, by design. So we resolve it
// with the admin client and project it down to a single display string.
// Nothing else about the household crosses that boundary.
//
// This must NOT be done with a PostgREST embed: the users-table RLS
// nulls embedded joins for non-admin readers.
import { createAdminClient } from "@/lib/supabase/admin";

// The generated Database types predate migration 181 (and 153), so the
// admin client is used untyped here — the same `Client = any` pattern
// the other household / ministry services use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type HouseholdLinkState = {
  pendingHouseholdId: string;
  // e.g. "Nathaly Seidel" — the name of whoever created that household.
  displayName: string;
};

export async function getHouseholdLinkState(
  pendingHouseholdId: string | null | undefined
): Promise<HouseholdLinkState | null> {
  if (!pendingHouseholdId) return null;

  const admin = createAdminClient() as Client;

  const { data: household } = await admin
    .from("households")
    .select("id, created_by")
    .eq("id", pendingHouseholdId)
    .maybeSingle();
  if (!household) return null;

  let displayName = "";
  if (household.created_by) {
    const { data: owner } = await admin
      .from("users")
      .select("first_name, last_name, preferred_name")
      .eq("id", household.created_by)
      .maybeSingle();
    if (owner) {
      displayName = [owner.first_name, owner.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();
    }
  }

  return {
    pendingHouseholdId: household.id,
    displayName: displayName || "another Hub member",
  };
}
