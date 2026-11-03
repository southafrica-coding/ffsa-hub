// An outbox on disk: one JSON file plus the queue's photos, in its own
// folder in the app's documents directory (kept across restarts, never
// cleared by the OS the way the cache folder can be). expo-file-system's
// SDK 58 File / Directory API.
//
// Writes go to queue.json.tmp and are then moved over queue.json (a rename),
// so a crash mid-write leaves the previous queue intact. A file that can't
// be read is copied to quarantine-<time>.json before anything overwrites it.

import { Directory, File, Paths } from "expo-file-system";

import { serializeStore } from "./persist";
import type { BaseItem } from "./queue";

export type QueueStorage<T extends BaseItem> = {
  /** The stored text (or, in tests, an already-parsed value); null if nothing is stored yet. */
  read(): Promise<unknown>;
  write(items: T[]): Promise<void>;
  /** Keep a copy of what's stored now (it couldn't be read) so nothing is lost. Optional for fakes. */
  quarantine?(raw: unknown): Promise<void>;
  deleteFile(uri: string): void;
  fileExists(uri: string): boolean;
  /** Photo files in the outbox folder, for tidying up abandoned drafts. */
  listFiles(): { uri: string; modifiedAt: number }[];
};

const QUEUE = "queue.json";
const TMP = `${QUEUE}.tmp`;
export const QUARANTINE_PREFIX = "quarantine-";

export function queueDir(dirName: string): Directory {
  const dir = new Directory(Paths.document, dirName);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function fileQueueStorage<T extends BaseItem>(dirName: string): QueueStorage<T> {
  return {
    async read() {
      const dir = queueDir(dirName);
      const file = new File(dir, QUEUE);
      if (file.exists) return file.text();
      // Only the temporary copy: the very first write was interrupted.
      const tmp = new File(dir, TMP);
      return tmp.exists ? tmp.text() : null;
    },

    async write(items) {
      const dir = queueDir(dirName);
      const tmp = new File(dir, TMP);
      if (tmp.exists) tmp.delete();
      tmp.create();
      tmp.writeSync(serializeStore(items));
      tmp.moveSync(new File(dir, QUEUE), { overwrite: true });
    },

    async quarantine(raw) {
      const dir = queueDir(dirName);
      const dest = new File(dir, `${QUARANTINE_PREFIX}${Date.now()}.json`);
      const file = new File(dir, QUEUE);
      if (file.exists) {
        // A byte-for-byte copy, whatever state the file is in.
        file.copySync(dest, { overwrite: true });
      } else if (typeof raw === "string") {
        dest.create({ overwrite: true });
        dest.writeSync(raw);
      }
    },

    deleteFile(uri) {
      const f = new File(uri);
      if (f.exists) f.delete();
    },

    fileExists(uri) {
      return new File(uri).exists;
    },

    listFiles() {
      return queueDir(dirName)
        .list()
        .filter((e): e is File => e instanceof File && !e.name.startsWith(QUEUE) && !e.name.startsWith(QUARANTINE_PREFIX))
        .map((f) => ({ uri: f.uri, modifiedAt: f.lastModified ?? 0 }));
    },
  };
}

/** Copy a prepared photo into an outbox folder under a fresh name. */
export function keepPhotoIn(dirName: string, sourceUri: string, name: string): { uri: string; size: number } {
  const dest = new File(queueDir(dirName), name);
  new File(sourceUri).copySync(dest, { overwrite: true });
  return { uri: dest.uri, size: dest.size ?? 0 };
}
