// The real file store against an in-memory expo-file-system (SDK 58 File /
// Directory / Paths): atomic write, versioned format, the interrupted first
// write, quarantine copies, and that tidy-up never sees the queue files.

const mockFiles = new Map<string, string>();
jest.mock("expo-file-system", () => {
  const join = (...parts: (string | { uri: string })[]) =>
    parts.map((p) => (typeof p === "string" ? p : p.uri)).reduce((a, b) => `${a.replace(/\/+$/, "")}/${b.replace(/^\/+/, "")}`);
  class File {
    uri: string;
    lastModified = 0;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(...parts);
    }
    get name() {
      return this.uri.split("/").pop() ?? "";
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get size() {
      return (mockFiles.get(this.uri) ?? "").length;
    }
    create() {
      mockFiles.set(this.uri, "");
    }
    delete() {
      mockFiles.delete(this.uri);
    }
    writeSync(s: string) {
      mockFiles.set(this.uri, s);
    }
    async text() {
      return mockFiles.get(this.uri) ?? "";
    }
    moveSync(dest: File) {
      mockFiles.set(dest.uri, mockFiles.get(this.uri) ?? "");
      mockFiles.delete(this.uri);
    }
    copySync(dest: File) {
      mockFiles.set(dest.uri, mockFiles.get(this.uri) ?? "");
    }
  }
  class Directory {
    uri: string;
    exists = true;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(...parts);
    }
    create() {}
    list() {
      return [...mockFiles.keys()].filter((k) => k.startsWith(`${this.uri}/`)).map((k) => new File(k));
    }
  }
  return { File, Directory, Paths: { document: { uri: "file:///docs" } } };
});

// eslint-disable-next-line import/first
import { fileQueueStorage, keepPhotoIn } from "../file-store";
// eslint-disable-next-line import/first
import type { BaseItem } from "../queue";

const Q = "file:///docs/test-outbox/queue.json";
const item: BaseItem = { id: "a", kind: "thing", userId: "u1", status: "waiting", attempts: 0, nextAttemptAt: 0, lastError: null, createdAt: 1 };

beforeEach(() => mockFiles.clear());

describe("file outbox storage", () => {
  const store = fileQueueStorage<BaseItem>("test-outbox");

  it("nothing stored yet reads as null", async () => {
    expect(await store.read()).toBeNull();
  });

  it("writes version 2 through a temporary file, leaving no temp behind", async () => {
    await store.write([item]);
    expect(JSON.parse(mockFiles.get(Q)!)).toEqual({ version: 2, items: [item] });
    expect(mockFiles.has(`${Q}.tmp`)).toBe(false);
    expect(await store.read()).toBe(mockFiles.get(Q));
  });

  it("an interrupted first write: reads the temporary copy rather than nothing", async () => {
    mockFiles.set(`${Q}.tmp`, '{"version":2,"items":[]}');
    expect(await store.read()).toBe('{"version":2,"items":[]}');
  });

  it("quarantine keeps a byte-for-byte copy of the damaged file", async () => {
    mockFiles.set(Q, "{broken");
    await store.quarantine!("{broken");
    const copies = [...mockFiles.keys()].filter((k) => k.includes("/quarantine-"));
    expect(copies).toHaveLength(1);
    expect(mockFiles.get(copies[0])).toBe("{broken");
    // The original is still there until the next write replaces it.
    expect(mockFiles.get(Q)).toBe("{broken");
  });

  it("quarantine with no queue file writes the raw text it was given", async () => {
    await store.quarantine!("{from tmp");
    const copies = [...mockFiles.keys()].filter((k) => k.includes("/quarantine-"));
    expect(mockFiles.get(copies[0])).toBe("{from tmp");
  });

  it("photo listing never includes the queue, its temp file or quarantine copies", async () => {
    mockFiles.set(Q, "[]");
    mockFiles.set(`${Q}.tmp`, "[]");
    mockFiles.set("file:///docs/test-outbox/quarantine-1.json", "x");
    mockFiles.set("file:///docs/test-outbox/p1.jpg", "jpg");
    expect(store.listFiles().map((f) => f.uri)).toEqual(["file:///docs/test-outbox/p1.jpg"]);
  });

  it("files: exists, delete, and keepPhotoIn copies into the folder", () => {
    mockFiles.set("file:///cache/shot.jpg", "jpeg");
    const kept = keepPhotoIn("test-outbox", "file:///cache/shot.jpg", "k.jpg");
    expect(kept).toEqual({ uri: "file:///docs/test-outbox/k.jpg", size: 4 });
    expect(store.fileExists(kept.uri)).toBe(true);
    store.deleteFile(kept.uri);
    expect(store.fileExists(kept.uri)).toBe(false);
    expect(() => store.deleteFile(kept.uri)).not.toThrow();
  });
});
