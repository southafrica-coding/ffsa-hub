/**
 * A path we are willing to send the browser to after login.
 * It must be a single-slash internal path. Query strings are allowed.
 * Protocol-relative URLs, backslashes, schemes and encoded `//` are not.
 */
export function safeInternalPath(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    return null;
  }
  if (!isInternalPath(trimmed) || !isInternalPath(decoded)) return null;
  return decoded;
}

function isInternalPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.includes("\\")) return false;
  if (path.includes("://")) return false;
  if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(path)) return false;
  return true;
}

/** Same check, named for the middleware and the auth callback. */
export function safeRedirect(value: string | null | undefined): string | null {
  return safeInternalPath(value);
}

/** Where login should go. A missing value stays missing. An unsafe one is /home. */
export function loginDestination(value: string | null | undefined): string | null {
  if (value == null) return null;
  return safeInternalPath(value) ?? "/home";
}
