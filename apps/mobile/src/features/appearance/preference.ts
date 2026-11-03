// The Appearance choice: match the phone, or always light / always dark.
//
// Stored on this phone only (AsyncStorage, like the other small app prefs),
// never on the server. It isn't personal data, so it is NOT cleared on sign
// out: the next person on a shared phone gets the same look.
//
// Applied through NativeWind's colorScheme.set(), which calls React Native's
// Appearance.setColorScheme(). That one override drives useColorScheme()
// (so useTheme()), NativeWind's `dark:` classes and native UI such as
// alerts, pickers and the keyboard. There is no second theme mechanism.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { colorScheme } from "nativewind";

import type { ColorScheme } from "@/theme/tokens";

export type AppearancePreference = "system" | "light" | "dark";

export const APPEARANCE_PREFERENCES: readonly AppearancePreference[] = ["system", "light", "dark"];

export const DEFAULT_PREFERENCE: AppearancePreference = "system";

export const STORAGE_KEY = "ffsa:appearance:v1";

export function isPreference(value: unknown): value is AppearancePreference {
  return typeof value === "string" && (APPEARANCE_PREFERENCES as readonly string[]).includes(value);
}

/** The scheme the app shows for a preference, given the phone's own setting. */
export function resolveScheme(pref: AppearancePreference, system: string | null | undefined): ColorScheme {
  if (pref === "light" || pref === "dark") return pref;
  return system === "dark" ? "dark" : "light";
}

/** Saved choice, or the default if nothing (or something unreadable) is stored. */
export async function readPreference(): Promise<AppearancePreference> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return isPreference(raw) ? raw : DEFAULT_PREFERENCE;
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

/** Throws if the phone couldn't save it (the caller says so; the look still changes). */
export async function writePreference(pref: AppearancePreference): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, pref);
}

/** Switch the whole app (and native UI) to this preference, right now. */
export function applyPreference(pref: AppearancePreference) {
  try {
    colorScheme.set(pref);
  } catch {
    // No native Appearance module (e.g. some test/web hosts): keep the system look.
  }
}
