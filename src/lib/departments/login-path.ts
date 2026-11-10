/** Login URL with a same-origin return path. Anything else is plain /login. */
export function loginPath(currentPath: string): string {
  if (currentPath.startsWith("/") && !currentPath.startsWith("//") && !currentPath.includes("\\")) {
    return "/login?redirect=" + encodeURIComponent(currentPath);
  }
  return "/login";
}
