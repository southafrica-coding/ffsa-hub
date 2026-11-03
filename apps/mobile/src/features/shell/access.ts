// What the signed-in person may see, from GET /api/me. UX ONLY: hiding a
// tab or a button never protects anything. The server (API + RLS) decides,
// and a hidden screen reached another way still gets a 403 from the API.

import type { Me } from "@/lib/api";

// Mirrors the web, where admins pass every role/permission gate.
export const ADMIN_ROLES = ["super_admin", "admin"] as const;

export function hasRole(me: Me | null, role: string): boolean {
  return !!me?.roles.some((r) => r.name === role);
}

export function isAdmin(me: Me | null): boolean {
  return ADMIN_ROLES.some((r) => hasRole(me, r));
}

/**
 * True if the person holds `permission` (any scope, direct or via a role),
 * or is an admin. False while /api/me hasn't loaded.
 */
export function can(me: Me | null, permission: string): boolean {
  if (!me) return false;
  return isAdmin(me) || me.permissions.some((p) => p.key === permission);
}

/** "team_leader" -> "Team leader" */
export function roleLabel(name: string): string {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : name;
}

/** Unique role names, readable, in the order the server sent them. */
export function roleLabels(me: Me | null): string[] {
  return [...new Set((me?.roles ?? []).map((r) => roleLabel(r.name)))];
}
