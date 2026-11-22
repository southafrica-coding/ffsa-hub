// Per-person Light / Dark / System setting.
//
// Saved on the person's own users row (users.color_scheme, migration 344) so
// it follows them across devices, and mirrored into a cookie so the script in
// <head> can apply it before the page paints.
//
//   'light' | 'dark'  a fixed choice
//   'system'          follow the device's prefers-color-scheme, live: the Hub
//                     flips when the phone or laptop switches at sunset. This
//                     is the default, and is stored as NULL on the users row.

export const COLOR_SCHEMES = ["light", "dark"] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const THEME_COOKIE = "ffsa-theme";
// One year. Re-written on every signed-in page load from the saved setting.
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isColorScheme(value: unknown): value is ColorScheme {
  return value === "light" || value === "dark";
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || isColorScheme(value);
}

/** The users.color_scheme value as a preference: NULL means "system". */
export function preferenceFromSaved(saved: unknown): ThemePreference {
  return isColorScheme(saved) ? saved : "system";
}

/** The cookie string written by the browser for a preference. */
export function themeCookie(preference: ThemePreference): string {
  return `${THEME_COOKIE}=${preference}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/** The preference remembered on this device. Browser only. */
export function readThemePreference(): ThemePreference {
  const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=(system|light|dark)`));
  return match ? (match[1] as ThemePreference) : "system";
}

/** What "system" resolves to on this device right now. Browser only. */
export function deviceColorScheme(): ColorScheme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Apply a preference to the page and remember it on this device. Browser
 * only. The live device listener installed by the <head> script reads the
 * cookie on every change, so switching to or from "system" needs nothing else.
 */
export function applyThemePreference(preference: ThemePreference): void {
  const scheme = preference === "system" ? deviceColorScheme() : preference;
  document.documentElement.classList.toggle("dark", scheme === "dark");
  document.documentElement.style.colorScheme = scheme;
  document.cookie = themeCookie(preference);
}
