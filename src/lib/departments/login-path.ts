import { safeInternalPath } from "@/lib/safe-redirect";

/** Login URL with a same-origin return path. Anything else is plain /login. */
export function loginPath(currentPath: string): string {
  const safe = safeInternalPath(currentPath);
  if (!safe) return "/login";
  return "/login?redirect=" + encodeURIComponent(safe);
}
