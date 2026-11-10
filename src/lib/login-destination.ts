import { safeRedirect } from "@/lib/safe-redirect";

/** Alias kept for the department login return path. */
export const safeInternalPath = safeRedirect;

/** Where login should go. A missing value stays missing. An unsafe one is /home. */
export function loginDestination(value: string | null | undefined): string | null {
  if (value == null) return null;
  return safeRedirect(value) ?? "/home";
}
