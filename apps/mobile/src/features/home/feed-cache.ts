// Last good feed per user, so Home opens instantly and works offline.
// AsyncStorage, keyed by user id so a second person signing in on the same
// phone never sees the first person's items. Cleared on sign-out (Me).
// Holds only what the feed shows (titles/bodies of the user's own items):
// no tokens.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";

import { feedItemSchema, type FeedItem } from "./api";

const PREFIX = "ffsa:home-feed:v1:";

const cachedSchema = z.object({
  savedAt: z.string(),
  items: z.array(feedItemSchema),
});

export type CachedFeed = z.infer<typeof cachedSchema>;

export async function readFeedCache(userId: string): Promise<CachedFeed | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + userId);
    if (!raw) return null;
    const parsed = cachedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // Corrupt or unreadable: behave as if there's nothing saved.
    return null;
  }
}

export async function writeFeedCache(userId: string, items: FeedItem[], now: Date = new Date()) {
  try {
    const value: CachedFeed = { savedAt: now.toISOString(), items };
    await AsyncStorage.setItem(PREFIX + userId, JSON.stringify(value));
  } catch {
    // Full disk etc.: the cache is a convenience, never an error.
  }
}

/** Remove every saved feed on this device (sign-out). */
export async function clearFeedCaches() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter((k) => k.startsWith(PREFIX));
    if (ours.length) await AsyncStorage.multiRemove(ours);
  } catch {
    // ignore
  }
}
