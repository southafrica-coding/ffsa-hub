import { MAX_ATTEMPTS, MIN_WAKE_GAP_MS } from "../backoff";
import { OutboxEngine, PermanentError, type EngineDeps } from "../engine";
import type { QueueStorage } from "../file-store";
import { serializeStore } from "../persist";
import type { BaseItem, Failure } from "../queue";

// A minimal queue on the shared engine: items carry a file and a body.
type Item = BaseItem & { kind: "thing"; file: string; body: string };

class AlreadyThere extends Error {}

class TestOutbox extends OutboxEngine<Item> {
  constructor(
    deps: EngineDeps<Item>,
    readonly sendImpl: jest.Mock<Promise<void>, [Item]>,
  ) {
    super(deps);
  }
  protected isItem(v: BaseItem) {
    return typeof (v as Item).file === "string";
  }
  protected pick(candidates: Item[]) {
    return [...candidates].sort((a, b) => a.createdAt - b.createdAt)[0];
  }
  protected send(item: Item) {
    return this.sendImpl(item);
  }
  protected files(item: Item) {
    return [item.file];
  }
  protected sameAs(a: Item, b: Item) {
    return a.file === b.file;
  }
  protected alreadyThere(_item: Item, err: unknown) {
    return err instanceof AlreadyThere;
  }
}

const item = (over: Partial<Item> = {}): Item => ({
  id: "a",
  kind: "thing",
  userId: "u1",
  status: "waiting",
  attempts: 0,
  nextAttemptAt: 0,
  lastError: null,
  createdAt: 1,
  file: "file:///a.jpg",
  body: "hello",
  ...over,
});

const classify = (err: unknown): Failure => {
  if (err instanceof PermanentError) return { permanent: true, message: err.message };
  return { permanent: false, message: err instanceof Error ? err.message : "?" };
};

function memory(raw: unknown = null) {
  const s = {
    raw,
    quarantined: [] as unknown[],
    deleted: [] as string[],
    readFails: false,
    writeFails: false,
    async read() {
      if (s.readFails) throw new Error("disk");
      return s.raw;
    },
    async write(items: Item[]) {
      if (s.writeFails) throw new Error("disk full");
      s.raw = serializeStore(items);
    },
    async quarantine(r: unknown) {
      s.quarantined.push(r);
    },
    deleteFile(uri: string) {
      s.deleted.push(uri);
    },
    fileExists: () => true,
    listFiles: () => [] as { uri: string; modifiedAt: number }[],
    saved(): Item[] {
      return s.raw ? JSON.parse(String(s.raw)).items : [];
    },
  };
  return s;
}

function setup(raw: unknown = null, over: Partial<EngineDeps<Item>> = {}) {
  const storage = memory(raw);
  const env = { online: true, user: "u1" as string | null, clock: 1_000_000 };
  const send = jest.fn<Promise<void>, [Item]>(async () => {});
  const deps: EngineDeps<Item> = {
    storage: storage as QueueStorage<Item>,
    classify,
    getUserId: async () => env.user,
    isOnline: async () => env.online,
    now: () => env.clock,
    ...over,
  };
  return { outbox: new TestOutbox(deps, send), storage, env, send };
}

describe("outbox engine", () => {
  it("writes the item to disk before sending it, then forgets it and deletes its file", async () => {
    const t = setup();
    t.send.mockImplementation(async () => {
      expect(t.storage.saved().map((i) => [i.id, i.status])).toEqual([["a", "sending"]]);
    });
    await t.outbox.add(item());
    await t.outbox.process();
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.outbox.getItems()).toEqual([]);
    expect(t.storage.saved()).toEqual([]);
    expect(t.storage.deleted).toEqual(["file:///a.jpg"]);
  });

  it("app killed mid-send: on restart it is waiting again, flagged maybe-sent, and sent once", async () => {
    // What the disk holds if the app died after "sending" was written.
    const t = setup(serializeStore([item({ status: "sending", lastTriedAt: 5 })]));
    await t.outbox.init();
    expect(t.outbox.getItems()[0]).toMatchObject({ status: "waiting", maybeSent: true });
    await t.outbox.process();
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.outbox.getItems()).toEqual([]);
  });

  it("restart keeps everything waiting, including the version 1 format", async () => {
    const t = setup(JSON.stringify([item(), item({ id: "b", file: "file:///b.jpg", status: "failed", lastError: "no" })]));
    t.env.online = false;
    await t.outbox.process();
    expect(t.outbox.getItems().map((i) => [i.id, i.status])).toEqual([
      ["a", "waiting"],
      ["b", "failed"],
    ]);
    expect(t.outbox.getProblem()).toBeNull();
  });

  it("offline → online: nothing goes while offline, everything once back", async () => {
    const t = setup();
    t.env.online = false;
    await t.outbox.add(item(), item({ id: "b", file: "file:///b.jpg", createdAt: 2 }));
    await t.outbox.process();
    expect(t.send).not.toHaveBeenCalled();
    t.env.online = true;
    await t.outbox.wake();
    expect(t.send.mock.calls.map(([i]) => i.id)).toEqual(["a", "b"]);
    expect(t.outbox.getItems()).toEqual([]);
  });

  it("a transient failure backs off; reconnecting doesn't retry within the minimum gap", async () => {
    const t = setup();
    t.send.mockRejectedValueOnce(new Error("timeout"));
    await t.outbox.add(item());
    await t.outbox.process();
    expect(t.outbox.getItems()[0]).toMatchObject({ status: "waiting", attempts: 1, lastError: "timeout", lastTriedAt: 1_000_000 });
    await t.outbox.wake();
    expect(t.send).toHaveBeenCalledTimes(1);
    t.env.clock += MIN_WAKE_GAP_MS;
    await t.outbox.wake();
    expect(t.send).toHaveBeenCalledTimes(2);
    expect(t.outbox.getItems()).toEqual([]);
  });

  it("429 Retry-After: waits as long as the server asks, even across a reconnect", async () => {
    const t = setup(null, { classify: () => ({ permanent: false, message: "Busy", retryAfterMs: 120_000 }) });
    t.send.mockRejectedValueOnce(new Error("429"));
    await t.outbox.add(item());
    await t.outbox.process();
    expect(t.outbox.getItems()[0]).toMatchObject({ nextAttemptAt: 1_120_000, holdUntil: 1_120_000 });
    t.env.clock += 60_000;
    await t.outbox.wake();
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(await t.outbox.nextWake()).toBe(1_120_000);
    t.env.clock = 1_120_000;
    await t.outbox.process();
    expect(t.send).toHaveBeenCalledTimes(2);
  });

  it("an 'already there' answer (409) counts as sent", async () => {
    const t = setup();
    t.send.mockRejectedValueOnce(new AlreadyThere("409"));
    await t.outbox.add(item());
    await t.outbox.process();
    expect(t.outbox.getItems()).toEqual([]);
    expect(t.storage.deleted).toEqual(["file:///a.jpg"]);
  });

  it(`after ${MAX_ATTEMPTS} transient failures it needs the person, and is never dropped`, async () => {
    const t = setup();
    t.send.mockRejectedValue(new Error("Couldn't reach FFSA Hub."));
    await t.outbox.add(item());
    for (let i = 0; i < MAX_ATTEMPTS + 3; i++) {
      t.env.clock += 10 * 60_000;
      await t.outbox.process();
    }
    expect(t.send).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(t.outbox.getItems()[0]).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(t.storage.saved()).toHaveLength(1);
    // Only the person brings it back.
    t.send.mockResolvedValue(undefined);
    await t.outbox.retry("a");
    await t.outbox.process();
    expect(t.outbox.getItems()).toEqual([]);
  });

  it("a permanent failure needs the person straight away", async () => {
    const t = setup();
    t.send.mockRejectedValueOnce(new PermanentError("You don't have access."));
    await t.outbox.add(item());
    await t.outbox.process();
    expect(t.outbox.getItems()[0]).toMatchObject({ status: "failed", lastError: "You don't have access." });
  });

  it("corrupted storage: the raw copy is quarantined, the problem is shown, nothing is wiped silently", async () => {
    const t = setup("{definitely not json");
    await t.outbox.init();
    expect(t.storage.quarantined).toEqual(["{definitely not json"]);
    expect(t.outbox.getProblem()).toBe("corrupt");
    // New items still save; the damaged copy was kept first.
    await t.outbox.add(item());
    expect(t.storage.saved()).toHaveLength(1);
    t.outbox.dismissProblem();
    expect(t.outbox.getProblem()).toBeNull();
  });

  it("partly readable storage: keeps what it can read and says so", async () => {
    const t = setup(JSON.stringify({ version: 2, items: [item(), { junk: true }] }));
    await t.outbox.init();
    expect(t.outbox.getItems().map((i) => i.id)).toEqual(["a"]);
    expect(t.outbox.getProblem()).toBe("partial");
    expect(t.storage.quarantined).toHaveLength(1);
  });

  it("a read that throws is treated as corrupt and quarantined", async () => {
    const t = setup("x");
    t.storage.readFails = true;
    await t.outbox.init();
    expect(t.outbox.getProblem()).toBe("corrupt");
    expect(t.storage.quarantined).toEqual([null]);
  });

  it("someone else signs in mid-queue: their session never sends my items", async () => {
    const t = setup();
    t.send.mockImplementation(async () => {
      t.env.user = "u2";
    });
    await t.outbox.add(item(), item({ id: "b", file: "file:///b.jpg", createdAt: 2 }));
    await t.outbox.process();
    expect(t.send.mock.calls.map(([i]) => i.id)).toEqual(["a"]);
    expect(t.outbox.getItems().map((i) => i.id)).toEqual(["b"]);
    expect(await t.outbox.nextWake()).toBeNull();
    t.env.user = null;
    await t.outbox.process();
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it("double enqueue: the same photo twice is one item; the same id again replaces", async () => {
    const t = setup();
    t.env.online = false;
    await t.outbox.add(item());
    await t.outbox.add(item({ id: "b" }));
    await t.outbox.add(item({ body: "edited" }));
    expect(t.outbox.getItems()).toHaveLength(1);
    expect(t.outbox.getItems()[0].body).toBe("edited");
  });

  it("concurrent process() calls share one run (nothing sent twice)", async () => {
    const t = setup();
    let release: () => void = () => {};
    t.send.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    await t.outbox.add(item());
    const a = t.outbox.process();
    const b = t.outbox.process();
    // Retry and Remove are refused while it's on the wire.
    await t.outbox.retry("a");
    expect(await t.outbox.discard("a")).toBe(false);
    release();
    await Promise.all([a, b]);
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.outbox.getItems()).toEqual([]);
  });

  it("Remove deletes the item and its file", async () => {
    const t = setup();
    t.env.online = false;
    await t.outbox.add(item());
    expect(await t.outbox.discard("a")).toBe(true);
    expect(t.outbox.getItems()).toEqual([]);
    expect(t.storage.deleted).toEqual(["file:///a.jpg"]);
    expect(await t.outbox.discard("missing")).toBe(false);
  });

  it("a disk write failing mid-run doesn't become an unhandled rejection", async () => {
    const t = setup();
    await t.outbox.add(item());
    t.storage.writeFails = true;
    await expect(t.outbox.process()).resolves.toBeUndefined();
  });

  it("uses the injected random for jitter", async () => {
    const t = setup(null, { random: () => 0 });
    t.send.mockRejectedValueOnce(new Error("x"));
    await t.outbox.add(item());
    await t.outbox.process();
    expect(t.outbox.getItems()[0].nextAttemptAt).toBe(1_000_000 + 1_000);
  });

  it("tidies photo files nobody queued after a day, never queued ones", async () => {
    const t = setup(serializeStore([item()]));
    t.env.clock = 3 * 24 * 60 * 60_000;
    t.storage.listFiles = () => [
      { uri: "file:///a.jpg", modifiedAt: 0 },
      { uri: "file:///orphan.jpg", modifiedAt: 0 },
      { uri: "file:///fresh.jpg", modifiedAt: t.env.clock - 60_000 },
    ];
    await t.outbox.init();
    expect(t.storage.deleted).toEqual(["file:///orphan.jpg"]);
  });
});
