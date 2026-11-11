import { loginReturnPath } from "@/lib/login-destination";

/** Login URL with a same-origin return path. `/`, empty, and unsafe values are plain /login. */
export function loginPath(currentPath: string): string {
  const safe = loginReturnPath(currentPath);
  if (!safe) return "/login";
  return "/login?redirect=" + encodeURIComponent(safe);
}
