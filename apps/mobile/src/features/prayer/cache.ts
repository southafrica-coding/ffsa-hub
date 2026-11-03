// "Saved on this phone": each week that loads is kept, so the wall still opens
// with no signal ("Offline, showing saved week"). Keyed per signed-in user so
// a shared phone never shows one person's view to the next, and capped to the
// few most recent weeks. Names on the wall are visible to everyone in the
// room, so this holds nothing the person couldn't already see.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";

import { weekPayloadSchema, type WeekPayload } from "./api";

const PREFIX = "ffsa.prayer.weeks.v1:";
export const MAX_SAVED_WEEKS = 6;

const savedWeekSchema = z.object({ savedAt: z.string(), data: weekPayloadSchema });
const storeSchema = z.record(z.string(), savedWeekSchema);

export type SavedWeek = { savedAt: string; data: WeekPayload };

export const weekCacheKey = (userId: string) => `${PREFIX}${userId}`;

async function readStore(userId: string): Promise<Record<string, SavedWeek>> {
  try {
    const raw = await AsyncStorage.getItem(weekCacheKey(userId));
    if (!raw) return {};
    const parsed = storeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    // Unreadable cache reads as "nothing saved", never a crash.
    return {};
  }
}

export async function loadSavedWeek(userId: string, weekStart: string): Promise<SavedWeek | null> {
  return (await readStore(userId))[weekStart] ?? null;
}

/** Keeps the newest MAX_SAVED_WEEKS weeks by when they were saved. */
export function pruneWeeks(store: Record<string, SavedWeek>, max = MAX_SAVED_WEEKS): Record<string, SavedWeek> {
  const keep = Object.entries(store)
    .sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt))
    .slice(0, max);
  return Object.fromEntries(keep);
}

export async function saveWeek(userId: string, weekStart: string, data: WeekPayload, savedAt: string): Promise<void> {
  try {
    const store = await readStore(userId);
    store[weekStart] = { savedAt, data };
    await AsyncStorage.setItem(weekCacheKey(userId), JSON.stringify(pruneWeeks(store)));
  } catch {
    // Storage full or unavailable: the screen still works online.
  }
}
