import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, type ThemePreference } from "./index";

// Runs inline in <head>, before the body paints, on every page (admin,
// portal, auth and public). Reads the cookie the Hub keeps in step with the
// person's saved setting. With no cookie, or "system", it follows the device
// and keeps following it: a listener re-applies the theme when the device
// switches (e.g. auto dark mode at sunset), as long as the cookie still says
// "system". Kept tiny and dependency-free on purpose: it is shipped as a
// string and must not throw.
export const NO_FLASH_SCRIPT = `(function(){try{var d=document.documentElement,q=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)");function p(){var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(system|light|dark)/);return m?m[1]:"system"}function a(){var s=p();if(s==="system"){s=q&&q.matches?"dark":"light"}d.classList.toggle("dark",s==="dark");d.style.colorScheme=s}a();if(q){var l=function(){if(p()==="system")a()};q.addEventListener?q.addEventListener("change",l):q.addListener&&q.addListener(l)}}catch(e){}})();`;

/**
 * The saved setting for a signed-in person, applied as soon as the shell
 * HTML arrives — before the page under it paints — and written to the cookie
 * so this device matches the profile (covers a new device, and a change made
 * on another device). "system" defers to the device.
 */
export function savedSchemeScript(preference: ThemePreference): string {
  const p = JSON.stringify(preference);
  return `(function(){try{var p=${p},d=document.documentElement,s=p;if(p==="system"){s=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}d.classList.toggle("dark",s==="dark");d.style.colorScheme=s;document.cookie="${THEME_COOKIE}="+p+"; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax"}catch(e){}})();`;
}
