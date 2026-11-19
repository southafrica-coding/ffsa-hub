// The Face ID lock choice: stored on this phone only (AsyncStorage, like
// Appearance), never on the server. Unlike Appearance it belongs to the
// person who turned it on, so it IS cleared when they sign out.

import AsyncStorage from "@react-native-async-storage/async-storage";

export const LOCK_STORAGE_KEY = "ffsa:lock:v1";

const ON = "on";

/** Saved choice; off if nothing (or something unreadable) is stored. */
export async function readLockEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(LOCK_STORAGE_KEY)) === ON;
  } catch {
    return false;
  }
}

/** Throws if the phone couldn't save it (the caller says so). */
export async function writeLockEnabled(enabled: boolean): Promise<void> {
  if (enabled) await AsyncStorage.setItem(LOCK_STORAGE_KEY, ON);
  else await AsyncStorage.removeItem(LOCK_STORAGE_KEY);
}

export async function clearLockEnabled(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LOCK_STORAGE_KEY);
  } catch {
    // Nothing else to do: the next read falls back to off only if it's gone.
  }
}
