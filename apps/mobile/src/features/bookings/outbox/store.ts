// The vehicle-check outbox on disk: the shared versioned, crash-safe file
// store (src/lib/outbox/file-store.ts) in its own folder, not finance's, so
// the two outboxes' tidy-up passes never touch each other's photos.

import { fileQueueStorage as fileStore, keepPhotoIn, queueDir } from "@/lib/outbox/file-store";

import type { QueueStorage } from "./runner";

const DIR_NAME = "bookings-outbox";

export const outboxDir = () => queueDir(DIR_NAME);

export const fileQueueStorage: QueueStorage = fileStore(DIR_NAME);

/** Copy a prepared photo into the outbox folder under a fresh name. */
export function keepPhoto(sourceUri: string, name: string): { uri: string; size: number } {
  return keepPhotoIn(DIR_NAME, sourceUri, name);
}
