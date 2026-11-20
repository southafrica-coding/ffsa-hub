import { THEME_COOKIE, THEME_COOKIE_MAX_AGE } from "./index";

// Runs inline in <head>, before the body paints, on every page (admin,
// portal, auth and public). Reads the cookie the Hub keeps in step with the
// person's saved setting; with no cookie yet it follows the device and
// remembers that answer. Kept tiny and dependency-free on purpose: it is
// shipped as a string and must not throw.
export const NO_FLASH_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark)/);var s=m?m[1]:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");if(!m){document.cookie="${THEME_COOKIE}="+s+"; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax"}var d=document.documentElement;if(s==="dark"){d.classList.add("dark")}d.style.colorScheme=s}catch(e){}})();`;

/**
 * The saved setting for a signed-in person, applied as soon as the shell
 * HTML arrives — before the page under it paints — when it differs from
 * what this device had. Covers the first visit on a new device.
 */
export function savedSchemeScript(scheme: "light" | "dark"): string {
  return `(function(){try{var d=document.documentElement;d.classList.toggle("dark",${JSON.stringify(
    scheme
  )}==="dark");d.style.colorScheme=${JSON.stringify(scheme)};document.cookie="${THEME_COOKIE}=${scheme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax"}catch(e){}})();`;
}
