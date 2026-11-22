"use client";

import { useEffect, useState } from "react";

/**
 * Missio's light (paper) / dark (ink) ground, separate from the Hub's own
 * Light / Dark setting. "auto" follows the device (prefers-color-scheme);
 * missio-theme.css does the work, keyed on <html data-missio-theme>.
 */
export type MissioThemeChoice = "auto" | "light" | "dark";

export const MISSIO_THEME_KEY = "missio-theme";
const ATTR = "data-missio-theme";

/** `#dark`, `#light`, `?theme=dark` or `?theme=light` pin a ground, like the approved mockups. */
export function themeFromUrl(hash: string, search: string): MissioThemeChoice | null {
  const tag = hash.replace(/^#/, "").toLowerCase();
  if (tag === "dark" || tag === "light") return tag;
  const param = new URLSearchParams(search).get("theme")?.toLowerCase();
  return param === "dark" || param === "light" ? param : null;
}

export function applyMissioTheme(choice: MissioThemeChoice, root: HTMLElement = document.documentElement): void {
  if (choice === "auto") root.removeAttribute(ATTR);
  else root.setAttribute(ATTR, choice);
}

export function storedMissioTheme(): MissioThemeChoice {
  try {
    const value = window.localStorage.getItem(MISSIO_THEME_KEY);
    return value === "light" || value === "dark" ? value : "auto";
  } catch {
    return "auto";
  }
}

const NEXT: Record<MissioThemeChoice, MissioThemeChoice> = { auto: "light", light: "dark", dark: "auto" };
const LABEL: Record<MissioThemeChoice, string> = { auto: "Auto", light: "Light", dark: "Dark" };

/** Public Missio pages: follow the device, or the URL's `#dark` / `#light`. Leaves no trace on Hub pages. */
export function MissioThemeFromUrl() {
  useEffect(() => {
    const sync = () => applyMissioTheme(themeFromUrl(window.location.hash, window.location.search) ?? "auto");
    sync();
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      applyMissioTheme("auto");
    };
  }, []);
  return null;
}

/** The logged-in shell: Auto → Light → Dark, remembered on this device. A URL `#dark` / `#light` wins for that visit. */
export function MissioThemeToggle({ className }: { className?: string }) {
  const [choice, setChoice] = useState<MissioThemeChoice>("auto");

  useEffect(() => {
    const initial = themeFromUrl(window.location.hash, window.location.search) ?? storedMissioTheme();
    setChoice(initial);
    applyMissioTheme(initial);
    return () => applyMissioTheme("auto");
  }, []);

  return (
    <button
      type="button"
      className={className}
      data-testid="missio-theme-toggle"
      data-theme-choice={choice}
      aria-label={`Colours: ${LABEL[choice]}. Change to ${LABEL[NEXT[choice]]}`}
      onClick={() => {
        const next = NEXT[choice];
        setChoice(next);
        applyMissioTheme(next);
        try {
          if (next === "auto") window.localStorage.removeItem(MISSIO_THEME_KEY);
          else window.localStorage.setItem(MISSIO_THEME_KEY, next);
        } catch {
          // Private mode: the choice lasts for this visit only.
        }
      }}
    >
      {LABEL[choice]}
    </button>
  );
}
