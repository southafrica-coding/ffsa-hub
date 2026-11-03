// Appearance setting (Me > Appearance). English only for now; kept in one
// place so translation can come later.

import type { ColorScheme } from "@/theme/tokens";

import type { AppearancePreference } from "./preference";

const schemeWord = (scheme: ColorScheme) => (scheme === "dark" ? "dark" : "light");

export const appearanceStrings = {
  title: "Appearance",
  intro: "Choose how the app looks on this phone.",
  groupLabel: "Appearance",
  options: {
    system: {
      label: "Match phone",
      body: (scheme: ColorScheme) => `Uses your phone's light or dark setting. Now ${schemeWord(scheme)}.`,
    },
    light: { label: "Light", body: () => "Always light, whatever your phone is set to." },
    dark: { label: "Dark", body: () => "Always dark, whatever your phone is set to." },
  } satisfies Record<AppearancePreference, { label: string; body: (scheme: ColorScheme) => string }>,
  selectedHint: "Selected",
  chooseHint: "Double tap to use this look",
  deviceOnly: "Saved on this phone only. It stays the same when you sign out.",
  saveFailed: {
    title: "Couldn't save your choice",
    body: "The app is using it now, but your phone didn't save it, so it may change back next time. Try choosing it again.",
  },
  /** One line for the Me screen row. */
  summary: (pref: AppearancePreference, scheme: ColorScheme) =>
    pref === "system" ? `Match phone (now ${schemeWord(scheme)})` : pref === "dark" ? "Dark" : "Light",
};
