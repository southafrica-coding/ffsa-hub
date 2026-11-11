import { safeRedirect } from "@/lib/safe-redirect";

/** Alias kept for the department login return path. */
export const safeInternalPath = safeRedirect;

const HOME = "/home";

function pathnameOf(path: string): string | null {
  try {
    let pathname = new URL(path, "https://hub.invalid").pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.replace(/\/+$/, "");
    return pathname;
  } catch {
    return null;
  }
}

/** `/` and the login page (any query) are not a place to send someone back to. */
function isNoReturnPath(path: string): boolean {
  const pathname = pathnameOf(path);
  return pathname === "/" || pathname === "/login";
}

/**
 * A safe internal path worth returning to after sign-in.
 * Missing, empty, `/`, `/login` (including a nested redirect), and unsafe
 * values are not one — the caller lands on /home instead.
 */
export function loginReturnPath(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const safe = safeRedirect(value);
  if (!safe || isNoReturnPath(safe)) return null;
  return safe;
}

/** Where login should go. A missing value stays missing. Anything else with no return path is /home. */
export function loginDestination(value: string | null | undefined): string | null {
  if (value == null) return null;
  return loginReturnPath(value) ?? HOME;
}
