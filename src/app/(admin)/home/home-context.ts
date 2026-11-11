import { shellVariantForRoles } from "@/components/shell-nav";
import { STAFF_LANGUAGE } from "@/lib/departments/data";

/** Context line for a portal-only person. Staff keep STAFF_LANGUAGE. */
export const PORTAL_HOME_CONTEXT = "Your school, fees and prayer";

export function homeContext(userRoles: string[], menuLoadFailed = false): string {
  if (!menuLoadFailed && shellVariantForRoles(userRoles) === "portal") return PORTAL_HOME_CONTEXT;
  return STAFF_LANGUAGE;
}
