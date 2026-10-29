// ────────────────────────────────────────────────────────────
// HOUSEHOLD MEMBER — request sanitisation
// ────────────────────────────────────────────────────────────
// Shared by the POST (create) and PUT (update) household routes. Picks
// only the writable columns off the request body, coerces empty strings
// to null (so date columns don't choke on ""), normalises the boolean
// is_international flag, and validates relationship + full_name.

import type { HouseholdMemberInput } from "@/services/household";
import { HOUSEHOLD_RELATIONSHIP_OPTIONS } from "@/lib/users/profile-fields";

const SCALAR_FIELDS = [
  "relationship",
  "full_name",
  "first_name",
  "last_name",
  "email",
  "date_of_birth",
  "gender",
  "passport_country",
  "passport_number",
  "passport_expiry_date",
  "visa_category",
  "visa_type",
  "visa_expiry_date",
  "health_insurance_provider",
  "health_insurance_policy_number",
  "health_insurance_expiry_date",
] as const;

const RELATIONSHIPS = new Set(HOUSEHOLD_RELATIONSHIP_OPTIONS.map((o) => o.value));

export function sanitizeHouseholdInput(
  body: Record<string, unknown>,
  opts: { requireCore: boolean }
): { input: HouseholdMemberInput; error?: string } {
  const input: HouseholdMemberInput = {};

  for (const key of SCALAR_FIELDS) {
    if (!(key in body)) continue;
    const raw = body[key];
    const value = typeof raw === "string" ? raw.trim() : raw;
    // Empty strings become null so nullable date/text columns stay clean.
    (input as Record<string, unknown>)[key] =
      value === "" || value === undefined ? null : value;
  }

  if ("is_international" in body) {
    input.is_international = Boolean(body.is_international);
  }

  // An open-ended medical scheme carries no expiry date — the two are
  // mutually exclusive in the database, so the date is cleared here rather
  // than letting a stale value trip the CHECK constraint.
  if ("health_insurance_no_expiry" in body) {
    const noExpiry = Boolean(body.health_insurance_no_expiry);
    (input as Record<string, unknown>).health_insurance_no_expiry = noExpiry;
    if (noExpiry) {
      (input as Record<string, unknown>).health_insurance_expiry_date = null;
    }
  }

  // Relationship, when provided, must be one of the allowed values.
  if (input.relationship != null && !RELATIONSHIPS.has(String(input.relationship))) {
    return { input, error: "Please choose a valid relationship." };
  }

  const isSpouse = input.relationship === "spouse";

  // A spouse is captured lightly (first/last/email). Keep full_name — a
  // NOT NULL column and what every list/display consumer reads — populated
  // from the two name parts so the rest of the app is unaffected.
  if (isSpouse) {
    const first = input.first_name ? String(input.first_name).trim() : "";
    const last = input.last_name ? String(input.last_name).trim() : "";
    const composed = `${first} ${last}`.trim();
    if (composed) input.full_name = composed;
  }

  if (opts.requireCore) {
    if (!input.relationship) {
      return { input, error: "Relationship is required." };
    }
    if (isSpouse) {
      if (!input.first_name || String(input.first_name).trim() === "") {
        return { input, error: "Spouse first name is required." };
      }
      if (!input.last_name || String(input.last_name).trim() === "") {
        return { input, error: "Spouse last name is required." };
      }
      if (!input.email || String(input.email).trim() === "") {
        return { input, error: "Spouse email is required." };
      }
    } else if (!input.full_name || String(input.full_name).trim() === "") {
      return { input, error: "Full name is required." };
    }
  }

  return { input };
}

// The caller's own marital status, for the spouse rule in marital-status.ts.
// Null on a read error, which the rule treats as "unknown" (allowed) — a
// transient blip must not stop someone saving their family.
export async function getOwnMaritalStatus(
  supabase: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("users")
    .select("marital_status")
    .eq("id", userId)
    .maybeSingle();
  return (data?.marital_status as string | null | undefined) ?? null;
}
