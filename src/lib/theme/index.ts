// Per-person Light / Dark setting.
//
// Saved on the person's own users row (users.color_scheme, migration 344) so
// it follows them across devices, and mirrored into a cookie so the script in
// <head> can apply it before the page paints. Until they pick, the device's
// prefers-color-scheme decides, and that first answer is remembered in the
// cookie.

export const COLOR_SCHEMES = ["light", "dark"] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

export const THEME_COOKIE = "ffsa-theme";
// One year. Re-written on every visit where the saved setting differs.
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isColorScheme(value: unknown): value is ColorScheme {
  return value === "light" || value === "dark";
}

/** The cookie string written by the browser for a scheme. */
export function themeCookie(scheme: ColorScheme): string {
  return `${THEME_COOKIE}=${scheme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/** Apply a scheme to the page and remember it on this device. Browser only. */
export function applyColorScheme(scheme: ColorScheme): void {
  document.documentElement.classList.toggle("dark", scheme === "dark");
  document.documentElement.style.colorScheme = scheme;
  document.cookie = themeCookie(scheme);
}
