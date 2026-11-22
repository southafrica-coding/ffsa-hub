// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyThemePreference,
  isColorScheme,
  isThemePreference,
  preferenceFromSaved,
  readThemePreference,
  THEME_COOKIE,
} from "./index";
import { NO_FLASH_SCRIPT, savedSchemeScript } from "./no-flash-script";

function clearCookie() {
  document.cookie = `${THEME_COOKIE}=; Max-Age=0; Path=/`;
}

// A fake prefers-color-scheme query whose answer can be flipped, firing the
// change listeners the way a real device does at sunset.
function mockDevice(dark: boolean) {
  const listeners: Array<() => void> = [];
  const mq = {
    matches: dark,
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
  };
  window.matchMedia = vi.fn().mockReturnValue(mq) as unknown as typeof window.matchMedia;
  return {
    flip(next: boolean) {
      mq.matches = next;
      listeners.forEach((fn) => fn());
    },
  };
}
const run = (src: string) => new Function(src)();
const isDark = () => document.documentElement.classList.contains("dark");

describe("theme", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
    clearCookie();
  });
  afterEach(clearCookie);

  it("knows the schemes and preferences", () => {
    expect(isColorScheme("light")).toBe(true);
    expect(isColorScheme("dark")).toBe(true);
    expect(isColorScheme("system")).toBe(false);
    expect(isColorScheme(null)).toBe(false);
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
    expect(preferenceFromSaved(null)).toBe("system");
    expect(preferenceFromSaved("dark")).toBe("dark");
  });

  it("follows a dark device on a first visit without freezing it in a cookie", () => {
    mockDevice(true);
    run(NO_FLASH_SCRIPT);
    expect(isDark()).toBe(true);
    expect(document.cookie).not.toContain(`${THEME_COOKIE}=dark`);
  });

  it("follows a light device on a first visit", () => {
    mockDevice(false);
    run(NO_FLASH_SCRIPT);
    expect(isDark()).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("keeps following the device live while the preference is system", () => {
    const device = mockDevice(false);
    run(NO_FLASH_SCRIPT);
    expect(isDark()).toBe(false);
    device.flip(true);
    expect(isDark()).toBe(true);
    device.flip(false);
    expect(isDark()).toBe(false);
  });

  it("ignores device changes once a fixed choice is made", () => {
    const device = mockDevice(false);
    run(NO_FLASH_SCRIPT);
    applyThemePreference("light");
    device.flip(true);
    expect(isDark()).toBe(false);
    applyThemePreference("system");
    expect(isDark()).toBe(true);
    expect(readThemePreference()).toBe("system");
  });

  it("prefers the remembered cookie over the device", () => {
    mockDevice(false);
    document.cookie = `${THEME_COOKIE}=dark; Path=/`;
    run(NO_FLASH_SCRIPT);
    expect(isDark()).toBe(true);
  });

  it("brings a device in line with the saved profile setting", () => {
    mockDevice(true);
    document.cookie = `${THEME_COOKIE}=dark; Path=/`;
    document.documentElement.classList.add("dark");
    run(savedSchemeScript("light"));
    expect(isDark()).toBe(false);
    expect(document.cookie).toContain(`${THEME_COOKIE}=light`);
  });

  it("a profile set back to system undoes a fixed choice remembered on this device", () => {
    mockDevice(false);
    document.cookie = `${THEME_COOKIE}=dark; Path=/`;
    document.documentElement.classList.add("dark");
    run(savedSchemeScript("system"));
    expect(isDark()).toBe(false);
    expect(document.cookie).toContain(`${THEME_COOKIE}=system`);
  });
});
