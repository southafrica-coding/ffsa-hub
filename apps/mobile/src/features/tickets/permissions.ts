// Who sees the door check-in entry. UX only: the server decides on every
// request (403 is handled as "you can't run check-in").
//
// Mirrors the website's canManageEvents(…, ["events.manage_attendance"])
// in src/lib/api-auth.ts exactly: a managing events role, OR the permission
// granted directly (that helper reads user_permissions only, so a grant
// that arrives via a role bundle is NOT enough there, and isn't here).

import type { Me } from "@/lib/api";

export const EVENTS_MANAGE_ROLES = ["super_admin", "admin", "events_admin"] as const;
export const CHECK_IN_PERMISSION = "events.manage_attendance";

export function canRunCheckIn(me: Me | null | undefined): boolean {
  if (!me) return false;
  if (me.roles.some((r) => (EVENTS_MANAGE_ROLES as readonly string[]).includes(r.name))) return true;
  return me.permissions.some((p) => p.key === CHECK_IN_PERMISSION && p.source === "direct");
}
