/**
 * An internal path we will navigate to.
 * Self-contained: Hub Backend copies this file into a main hotfix.
 * Query and hash are kept. Control characters, whitespace, backslashes,
 * schemes, and protocol-relative URLs are not.
 */
const SENTINEL = "https://hub.invalid";
const CONTROL_OR_WHITESPACE = /[\u0000-\u001F\u007F\s]/;

export function safeRedirect(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (!isCandidate(value) || !isCandidate(decoded)) return null;
  let url: URL;
  try {
    url = new URL(decoded, SENTINEL);
  } catch {
    return null;
  }
  if (url.origin !== SENTINEL) return null;
  if (url.pathname.startsWith("//")) return null;
  return url.pathname + url.search + url.hash;
}

export const safeInternalPath = safeRedirect;

function isCandidate(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.includes("\\")) return false;
  if (CONTROL_OR_WHITESPACE.test(path)) return false;
  if (path.includes("://")) return false;
  if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(path)) return false;
  return true;
}

/** Where login should go. A missing value stays missing. An unsafe one is /home. */
export function loginDestination(value: string | null | undefined): string | null {
  if (value == null) return null;
  return safeRedirect(value) ?? "/home";
}
