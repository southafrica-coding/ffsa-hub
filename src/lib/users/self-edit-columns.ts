// Columns a signed-in user may UPDATE on public.users through the user
// client. This list MUST match migration 315's GRANT UPDATE
// (supabase/migrations/315_users_self_update_lockdown.sql, PR #544).
// Hub Data owns that migration — do not copy it into this branch.
//
// 34 free self-edit columns. The trigger
// users_guard_privileged_self_update allows these on the caller's own
// row with no further check (once the caller is signed in and active).
//
// users.has_children is NOT granted. It is privileged: a non-admin change
// is 42501. The profile route still accepts a has_children key and writes
// households.has_children. It must never appear in a users UPDATE.

export const USER_SELF_EDIT_COLUMNS = [
  "first_name",
  "last_name",
  "preferred_name",
  "date_of_birth",
  "gender",
  "marital_status",
  "nationality",
  "phone",
  "address_line_1",
  "address_line_2",
  "city",
  "province",
  "country",
  "postal_code",
  "emergency_contact_name",
  "emergency_contact_phone",
  "emergency_contact_relationship",
  "health_insurance_provider",
  "health_insurance_policy_number",
  "health_insurance_expiry_date",
  "health_insurance_no_expiry",
  "health_insurance_confirmed_at",
  "next_health_insurance_provider",
  "next_health_insurance_policy_number",
  "next_health_insurance_expiry_date",
  "next_health_insurance_no_expiry",
  "passport_country",
  "passport_number",
  "passport_expiry_date",
  "visa_category",
  "visa_type",
  "visa_expiry_date",
  "is_international",
  "essence_statement",
] as const;

// Granted, but the trigger checks them. department: staff only, and never
// leadership_team. status: only to 'active', and not from pending_approval.
// accepted_at: only while it is still NULL.
export const USER_SELF_EDIT_CHECKED_COLUMNS = [
  "department",
  "accepted_at",
  "status",
] as const;

// Granted so an is_admin() caller can write it on the user client.
// /api/admin/approve-user is the only app path that does.
export const USER_ADMIN_CLIENT_COLUMNS = ["job_title"] as const;

export type UserSelfEditColumn = (typeof USER_SELF_EDIT_COLUMNS)[number];
export type UserSelfEditCheckedColumn =
  (typeof USER_SELF_EDIT_CHECKED_COLUMNS)[number];
export type UserAdminClientColumn = (typeof USER_ADMIN_CLIENT_COLUMNS)[number];

const SELF_EDIT = new Set<string>(USER_SELF_EDIT_COLUMNS);

export function isUserSelfEditColumn(key: string): boolean {
  return SELF_EDIT.has(key);
}

/**
 * Split an input object into allowlisted keys and the rest.
 * Callers must reject `rejected` with 400 — never drop those keys quietly.
 */
export function pickUserColumns(
  input: Record<string, unknown>,
  allowed: readonly string[]
): { picked: Record<string, unknown>; rejected: string[] } {
  const allow = new Set(allowed);
  const picked: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const key of Object.keys(input)) {
    if (allow.has(key)) picked[key] = input[key];
    else rejected.push(key);
  }
  rejected.sort();
  return { picked, rejected };
}

export function rejectedFieldsMessage(fields: readonly string[]): string {
  return `You can't change these fields: ${fields.join(", ")}.`;
}
