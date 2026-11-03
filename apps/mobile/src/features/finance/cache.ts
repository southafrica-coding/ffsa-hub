// Last good copy of each finance screen, so the app still shows something
// useful in the field with no signal. It's money data, so it is stored with
// the same encrypted store as the session (keys in the Keychain/Keystore),
// and it's keyed by user so a shared phone never shows one person's teams
// to another.

import { largeSecureStore } from "@/lib/secure-storage";

const VERSION = 1;

export type Cached<T> = { savedAt: number; data: T };

function key(userId: string, name: string) {
  return `ffsa.finance.v${VERSION}.${userId}.${name}`;
}

export async function readCache<T>(userId: string, name: string): Promise<Cached<T> | null> {
  try {
    const raw = await largeSecureStore.getItem(key(userId, name));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached<T>;
    return typeof parsed?.savedAt === "number" && "data" in parsed ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeCache<T>(userId: string, name: string, data: T, now = Date.now()): Promise<void> {
  try {
    await largeSecureStore.setItem(key(userId, name), JSON.stringify({ savedAt: now, data }));
  } catch {
    // A full or locked store only costs the offline copy, never the screen.
  }
}

export function formatSavedAt(savedAt: number, now = Date.now()): string {
  const d = new Date(savedAt);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const sameDay = new Date(now).toDateString() === d.toDateString();
  if (sameDay) return `${hh}:${mm}`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${hh}:${mm}`;
}
