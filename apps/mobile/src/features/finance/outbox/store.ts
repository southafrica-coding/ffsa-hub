// The outbox on disk: one JSON file plus the compressed receipt photos, in
// the app's documents folder (kept across restarts and never cleared by the
// OS the way the cache folder can be). expo-file-system's SDK 58 File /
// Directory API.

import { Directory, File, Paths } from "expo-file-system";

import type { OutboxStorage } from "./runner";
import type { OutboxItem } from "./state";

const DIR_NAME = "finance-outbox";
const QUEUE = "queue.json";

export function outboxDir(): Directory {
  const dir = new Directory(Paths.document, DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export const fileOutboxStorage: OutboxStorage = {
  async read() {
    const file = new File(outboxDir(), QUEUE);
    if (!file.exists) return [];
    const parsed: unknown = JSON.parse(await file.text());
    return Array.isArray(parsed) ? (parsed as OutboxItem[]) : [];
  },

  async write(items) {
    const dir = outboxDir();
    // Write a temporary file then move it over the queue, so a crash
    // mid-write never leaves a half-written queue behind.
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
