// Who may be added to a ministry roster (as staff or as a leader).
//
// Only active people whose HUB profile is fully set up — the same fields the
// profile-completion gate blocks on. The picker shows everyone else greyed
// out with what's missing, so they can be found and chased; this module is
// what both the picker and the add/leader API routes check, so the rule
// can't be bypassed by calling the API directly.
//
// No Ministry is different: the database adds staff to it automatically
// (migrations 206 / 267) without this check.

import { deriveUserLifecycle, groupMissingFields } from "@/lib/users/lifecycle";

/**
 * Section names ("Address", "Passport", …) of the required fields this user
 * is missing. Empty means they can be added to a roster.
 */
export function missingProfileSections(user: Record<string, unknown>): string[] {
  return groupMissingFields(deriveUserLifecycle(user).missingFields).map((g) => g.section);
}

/**
 * Why this user can't be put on a roster, or null if they can. Loads the full
 * user row with the given (service-role) client.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rosterBlockReason(admin: any, userId: string): Promise<string | null> {
  const { data: target } = await admin.from("users").select("*").eq("id", userId).maybeSingle();
  if (!target) return "That person doesn't exist";
  if (target.is_active === false) return "That account is deactivated";
  const missing = missingProfileSections(target);
  if (missing.length > 0) {
    return `Their HUB profile isn't finished yet — missing: ${missing.join(", ")}`;
  }
  return null;
}
