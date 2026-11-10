// Who sees the door check-in entry. UX only: the server decides on every
// request (403 is handled as "you can't run check-in").
//
// The website's check-in API is now event-scoped (canManageEvent +
// events.manage_attendance). This flag only decides whether the door tab
// is offered at all: an unscoped managing role, or a direct
// events.manage_attendance grant in any scope. The event list itself is
// filtered by /api/mobile/check-in-events.

import type { Me } from "@/lib/api";

export const EVENTS_MANAGE_ROLES = ["super_admin", "admin", "events_admin"] as const;
export const CHECK_IN_PERMISSION = "events.manage_attendance";

export function canRunCheckIn(me: Me | null | undefined): boolean {
  if (!me) return false;
  if (me.roles.some((r) => (EVENTS_MANAGE_ROLES as readonly string[]).includes(r.name))) return true;
  return me.permissions.some((p) => p.key === CHECK_IN_PERMISSION && p.source === "direct");
}
