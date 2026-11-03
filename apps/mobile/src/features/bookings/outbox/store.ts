// The vehicle-check outbox on disk: one JSON file plus the compressed
// photos, in its own folder in the app's documents directory (kept across
// restarts, never cleared by the OS). Its own folder, not finance's, so the
// two outboxes' tidy-up passes never touch each other's photos.

import { Directory, File, Paths } from "expo-file-system";

import type { QueueStorage } from "./runner";
import type { QueueItem } from "./state";

const DIR_NAME = "bookings-outbox";
const QUEUE = "queue.json";

export function outboxDir(): Directory {
  const dir = new Directory(Paths.document, DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export const fileQueueStorage: QueueStorage = {
  async read() {
    const file = new File(outboxDir(), QUEUE);
    if (!file.exists) return [];
    const parsed: unknown = JSON.parse(await file.text());
    return Array.isArray(parsed) ? (parsed as QueueItem[]) : [];
  },

  async write(items) {
    const dir = outboxDir();
    const tmp = new File(dir, `${QUEUE}.tmp`);
    if (tmp.exists) tmp.delete();
    tmp.create();
    tmp.writeSync(JSON.stringify(items));
    tmp.moveSync(new File(dir, QUEUE), { overwrite: true });
  },

  deleteFile(uri) {
    const f = new File(uri);
    if (f.exists) f.delete();
  },

  fileExists(uri) {
    return new File(uri).exists;
  },

  listFiles() {
    return outboxDir()
      .list()
      .filter((e): e is File => e instanceof File && !e.name.startsWith(QUEUE))
      .map((f) => ({ uri: f.uri, modifiedAt: f.lastModified ?? 0 }));
  },
};

/** Copy a prepared photo into the outbox folder under a fresh name. */
export function keepPhoto(sourceUri: string, name: string): { uri: string; size: number } {
  const dest = new File(outboxDir(), name);
  new File(sourceUri).copySync(dest, { overwrite: true });
  return { uri: dest.uri, size: dest.size ?? 0 };
}
