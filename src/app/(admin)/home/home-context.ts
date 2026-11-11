import { shellVariantForRoles, type StaffSignals } from "@/components/shell-nav";
import { STAFF_LANGUAGE } from "@/lib/departments/data";

/** Context line for a portal-only person. Staff keep STAFF_LANGUAGE. */
export const PORTAL_HOME_CONTEXT = "Your school, fees and prayer";

export function homeContext(
  userRoles: readonly string[],
  menuLoadFailed = false,
  options?: {
    departments?: readonly unknown[] | null;
    staffSignals?: StaffSignals | null;
  }
): string {
  if (menuLoadFailed) return STAFF_LANGUAGE;
  if (shellVariantForRoles(userRoles, options) === "portal") return PORTAL_HOME_CONTEXT;
  return STAFF_LANGUAGE;
}
