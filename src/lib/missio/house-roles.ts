// Client-safe: no server imports. The API gate (requireOrgRole in ./access)
// and the Missio shell both read this list, so Care in the nav cannot drift
// from who GET /api/missio/care lets in.

/** Roles that open house churches. Coaches and leaders see only their own houses. */
export const MISSIO_HOUSE_ROLES = ["pastor", "coach", "house_church_leader"] as const;

/** True when `roles` includes any of MISSIO_HOUSE_ROLES. */
export function holdsMissioHouseRole(roles: readonly string[]): boolean {
  return MISSIO_HOUSE_ROLES.some((role) => roles.includes(role));
}
