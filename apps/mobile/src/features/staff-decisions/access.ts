// Whether the app offers Staff decisions: only to people holding the
// leadership_team role. Role-only, like the web's ROLE_ONLY_MODULES: being
// admin or super_admin is NOT enough. Read from GET /api/me; UX only, the
// endpoints check again whoever calls them.

import type { Me } from "@/lib/api";
import { hasRole, useMe } from "@/features/shell";

export const STAFF_DECISIONS_ROLE = "leadership_team";

export type StaffDecisionsAccess = "checking" | "allowed" | "notAllowed" | "unknown";

/** Pure: "unknown" when /api/me couldn't be read (the screen then asks the server itself). */
export function staffDecisionsAccess(me: Me | null, status: "loading" | "ready" | "error"): StaffDecisionsAccess {
  if (me) return hasRole(me, STAFF_DECISIONS_ROLE) ? "allowed" : "notAllowed";
  if (status === "loading") return "checking";
  return "unknown";
}

export function useStaffDecisionsAccess(): StaffDecisionsAccess {
  const { me, status } = useMe();
  return staffDecisionsAccess(me, status);
}
