// The volunteer's first name, asked once per phone (the website's door does
// the same with localStorage). Unverified by design: it tells the organiser
// who worked the door, it is not an identity. Storage failures are never
// fatal: the person is simply asked again.

import AsyncStorage from "@react-native-async-storage/async-storage";

export const SCANNER_NAME_KEY = "ffsa.public-scan.name";
export const MAX_NAME = 60;

/** Trimmed and capped like the server does; empty means "no name". */
export function cleanScannerName(raw: string): string {
  return raw.trim().slice(0, MAX_NAME);
}

export async function loadScannerName(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(SCANNER_NAME_KEY);
    return value ? cleanScannerName(value) || null : null;
  } catch {
    return null;
  }
}

export async function saveScannerName(name: string): Promise<void> {
  await AsyncStorage.setItem(SCANNER_NAME_KEY, name).catch(() => undefined);
}

export async function clearScannerName(): Promise<void> {
  await AsyncStorage.removeItem(SCANNER_NAME_KEY).catch(() => undefined);
}
