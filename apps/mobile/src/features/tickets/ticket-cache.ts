// "Saved on this phone": every successful load of My tickets is written
// here so the QR still opens at a door with no signal.
//
// Keyed per signed-in user, so a shared phone never shows one person's
// tickets to the next. The codes are not secret from their owner (they're
// in the confirmation email), but they are what gets someone through the
// door, so they stay in app storage and are never logged.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";

import { myTicketsSchema, type MyTickets } from "./api";

const PREFIX = "ffsa.tickets.mine.v1:";

const cachedSchema = z.object({ savedAt: z.string(), data: myTicketsSchema });

export type CachedTickets = { savedAt: string; data: MyTickets };

export const ticketCacheKey = (userId: string) => `${PREFIX}${userId}`;

export async function loadCachedTickets(userId: string): Promise<CachedTickets | null> {
  try {
    const raw = await AsyncStorage.getItem(ticketCacheKey(userId));
    if (!raw) return null;
    const parsed = cachedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // Unreadable cache reads as "nothing saved", never a crash.
    return null;
  }
}

export async function saveCachedTickets(userId: string, data: MyTickets, savedAt: string): Promise<void> {
  try {
    await AsyncStorage.setItem(ticketCacheKey(userId), JSON.stringify({ savedAt, data }));
  } catch {
    // Storage full or unavailable: the screen still works online.
  }
}
