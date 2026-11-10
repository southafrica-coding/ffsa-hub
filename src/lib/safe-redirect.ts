/**
 * Internal path safe to use after the auth code exchange.
 * Protocol-relative URLs, schemes, backslashes, control characters, and
 * encoded forms of those (including double encoding) are rejected.
 */
const CONTROL_OR_WHITESPACE = /[\u0000-\u001F\u007F\s]/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const ENCODED_SLASH_OR_BACKSLASH = /%2f%2f|%5c/i;
const MAX_DECODE_ITERATIONS = 5;
const BASE = "https://hub.invalid";

function blocked(value: string): boolean {
  return (
    CONTROL_OR_WHITESPACE.test(value) ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    SCHEME.test(value) ||
    ENCODED_SLASH_OR_BACKSLASH.test(value)
  );
}

export function safeRedirect(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (blocked(value)) return null;

  let v = value;
  for (let i = 0; i < MAX_DECODE_ITERATIONS; i++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(v);
    } catch {
      return null;
    }
    if (decoded === v) {
      if (blocked(v)) return null;
      const u = new URL(v, BASE);
      if (u.origin !== BASE) return null;
      const redirect = u.pathname + u.search + u.hash;
      // Path normalization can turn "/.//evil.com" into "//evil.com".
      // new URL(next, origin) would then leave the site, so reject that too.
      if (blocked(redirect)) return null;
      if (new URL(redirect, BASE).origin !== BASE) return null;
      return redirect;
    }
    v = decoded;
    if (ENCODED_SLASH_OR_BACKSLASH.test(v)) return null;
  }

  return null;
}
