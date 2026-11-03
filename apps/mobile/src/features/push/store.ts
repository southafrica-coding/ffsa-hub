// What this phone remembers about push (AsyncStorage, no secrets): each
// person's choice for this phone, how often they've opened the app (for the
// pre-prompt rule), and the token last sent to the server. The Expo push
// token is an address for this phone, not a credential.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";

import type { Registration } from "./logic";

const KEY = "ffsa:push:v1";

const choiceSchema = z.object({
  enabled: z.boolean().optional(),
  dismissedAt: z.number().nullable().optional(),
  launches: z.number().optional(),
});

const stateSchema = z.object({
  people: z.record(z.string(), choiceSchema).catch({}),
  registration: z
    .object({ token: z.string(), appVersion: z.string(), userId: z.string() })
    .nullable()
    .catch(null),
});

export type PersonChoice = z.infer<typeof choiceSchema>;
export type PushLocalState = { people: Record<string, PersonChoice>; registration: Registration | null };

const EMPTY: PushLocalState = { people: {}, registration: null };

export async function readPushState(): Promise<PushLocalState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = stateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

async function write(state: PushLocalState) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full etc.: worst case we ask or register again next time.
  }
}

export async function updatePerson(userId: string, patch: PersonChoice): Promise<PushLocalState> {
  const state = await readPushState();
  const next = { ...state, people: { ...state.people, [userId]: { ...state.people[userId], ...patch } } };
  await write(next);
  return next;
}

export async function setRegistration(registration: Registration | null): Promise<void> {
  const state = await readPushState();
  await write({ ...state, registration });
}
