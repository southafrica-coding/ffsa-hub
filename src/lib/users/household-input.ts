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

  // Relationship, when provided, must be one of the allowed values.
  if (input.relationship != null && !RELATIONSHIPS.has(String(input.relationship))) {
    return { input, error: "Please choose a valid relationship." };
  }

  if (opts.requireCore) {
    if (!input.relationship) {
      return { input, error: "Relationship is required." };
    }
    if (!input.full_name || String(input.full_name).trim() === "") {
      return { input, error: "Full name is required." };
    }
  }

  return { input };
}
