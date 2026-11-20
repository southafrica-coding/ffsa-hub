// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isColorScheme, THEME_COOKIE } from "./index";
import { NO_FLASH_SCRIPT, savedSchemeScript } from "./no-flash-script";

function clearCookie() {
  document.cookie = `${THEME_COOKIE}=; Max-Age=0; Path=/`;
}
function mockDevice(dark: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: dark }) as unknown as typeof window.matchMedia;
}
const run = (src: string) => new Function(src)();

describe("theme", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
    clearCookie();
  });
  afterEach(clearCookie);

  it("accepts only light and dark", () => {
    expect(isColorScheme("light")).toBe(true);
    expect(isColorScheme("dark")).toBe(true);
    expect(isColorScheme("system")).toBe(false);
    expect(isColorScheme(null)).toBe(false);
  });

  it("follows a dark device on a first visit and remembers it", () => {
    mockDevice(true);
    run(NO_FLASH_SCRIPT);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.cookie).toContain(`${THEME_COOKIE}=dark`);
  });

  it("follows a light device on a first visit", () => {
    mockDevice(false);
    run(NO_FLASH_SCRIPT);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.cookie).toContain(`${THEME_COOKIE}=light`);
  });

  it("prefers the remembered cookie over the device", () => {
    mockDevice(false);
    document.cookie = `${THEME_COOKIE}=dark; Path=/`;
    run(NO_FLASH_SCRIPT);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("brings a device in line with the saved profile setting", () => {
    document.cookie = `${THEME_COOKIE}=dark; Path=/`;
    document.documentElement.classList.add("dark");
    run(savedSchemeScript("light"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.cookie).toContain(`${THEME_COOKIE}=light`);
  });
});
