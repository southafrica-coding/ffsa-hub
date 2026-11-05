// The finance outbox on disk: the shared versioned, crash-safe file store
// (src/lib/outbox/file-store.ts) in its own folder, plus the receipt photos.

import { fileQueueStorage, keepPhotoIn, queueDir } from "@/lib/outbox/file-store";

import type { OutboxStorage } from "./runner";

const DIR_NAME = "finance-outbox";

export const outboxDir = () => queueDir(DIR_NAME);

export const fileOutboxStorage: OutboxStorage = fileQueueStorage(DIR_NAME);

/** Copy a prepared photo into the outbox folder under a fresh name. */
export function keepPhoto(sourceUri: string, name: string): { uri: string; size: number } {
  return keepPhotoIn(DIR_NAME, sourceUri, name);
}
