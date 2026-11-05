import { MAX_ATTEMPTS, MIN_WAKE_GAP_MS } from "../backoff";
import {
  enqueueUnique,
  isMidSend,
  markDoneItem,
  markFailedItem,
  markSendingItem,
  nextWakeAtFor,
  recoverItems,
  retryItem,
  wakeItems,
  withDefaults,
  type BaseItem,
} from "../queue";

type Item = BaseItem & { file?: string };

const item = (over: Partial<Item> = {}): Item => ({
  id: "a",
  kind: "thing",
  userId: "u1",
  status: "waiting",
  attempts: 0,
  nextAttemptAt: 0,
  lastError: null,
  createdAt: 1,
  ...over,
});

const sameFile = (a: Item, b: Item) => !!a.file && a.file === b.file;

describe("shared outbox state machine", () => {
  it("fills in fields older stored items lack", () => {
    expect(withDefaults(item())).toMatchObject({ lastTriedAt: null, holdUntil: null, maybeSent: false });
    expect(withDefaults(item({ maybeSent: true })).maybeSent).toBe(true);
  });

  describe("enqueue", () => {
    it("adds, and the same id again replaces the old copy", () => {
      const q = enqueueUnique([item()], [item({ lastError: "new" }), item({ id: "b" })]);
      expect(q.map((i) => [i.id, i.lastError])).toEqual([
        ["a", "new"],
        ["b", null],
      ]);
    });

    it("never replaces an item that is mid-send", () => {
      const q = enqueueUnique([item({ status: "sending" })], [item({ lastError: "new" })]);
      expect(q).toEqual([item({ status: "sending" })]);
    });

    it("a double tap (same thing, new id) is ignored, but only for the same person", () => {
      const start = [item({ file: "x.jpg" })];
      expect(enqueueUnique(start, [item({ id: "b", file: "x.jpg" })], sameFile)).toHaveLength(1);
      expect(enqueueUnique(start, [item({ id: "b", file: "x.jpg", userId: "u2" })], sameFile)).toHaveLength(2);
      expect(enqueueUnique(start, [item({ id: "b", file: "y.jpg" })], sameFile)).toHaveLength(2);
    });
  });

  it("restart: sending goes back to waiting and is flagged maybe-sent", () => {
    const q = recoverItems([item({ status: "sending" }), item({ id: "b" }), item({ id: "c", status: "failed" })]);
    expect(q.map((i) => [i.status, i.maybeSent ?? false])).toEqual([
      ["waiting", true],
      ["waiting", false],
      ["failed", false],
    ]);
  });

  it("sending records when it was tried", () => {
    expect(markSendingItem([item()], "a", 5_000)[0]).toMatchObject({ status: "sending", lastTriedAt: 5_000 });
    expect(markSendingItem([item({ lastTriedAt: 9 })], "a")[0].lastTriedAt).toBe(9);
  });

  it("done means out of the queue", () => {
    expect(markDoneItem([item(), item({ id: "b" })], "a").map((i) => i.id)).toEqual(["b"]);
  });

  describe("failure", () => {
    it("transient: waits a growing, jittered delay and keeps the reason", () => {
      let q = markFailedItem([item()], "a", { permanent: false, message: "offline" }, 1_000);
      expect(q[0]).toMatchObject({ status: "waiting", attempts: 1, lastError: "offline", nextAttemptAt: 3_000, holdUntil: null });
      q = markFailedItem(q, "a", { permanent: false, message: "offline" }, 1_000, 0);
      expect(q[0]).toMatchObject({ attempts: 2, nextAttemptAt: 1_000 + 2_000 });
    });

    it("a server's Retry-After sets a hold and the delay", () => {
      const q = markFailedItem([item()], "a", { permanent: false, message: "busy", retryAfterMs: 60_000 }, 1_000);
      expect(q[0]).toMatchObject({ nextAttemptAt: 61_000, holdUntil: 61_000 });
    });

    it("permanent: needs the person straight away", () => {
      const q = markFailedItem([item()], "a", { permanent: true, message: "no access" }, 1_000);
      expect(q[0]).toMatchObject({ status: "failed", attempts: 1, lastError: "no access" });
    });

    it(`after ${MAX_ATTEMPTS} tries it needs the person (never dropped)`, () => {
      const q = markFailedItem([item({ attempts: MAX_ATTEMPTS - 1 })], "a", { permanent: false, message: "x" }, 0);
      expect(q).toHaveLength(1);
      expect(q[0]).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    });

    it("maybe-sent is sticky until the item is done", () => {
      let q = markFailedItem([item()], "a", { permanent: false, message: "timeout", ambiguous: true }, 0);
      expect(q[0].maybeSent).toBe(true);
      q = markFailedItem(q, "a", { permanent: false, message: "refused" }, 0);
      expect(q[0].maybeSent).toBe(true);
    });
  });

  describe("retry", () => {
    it("tries now, resetting the count only if it had given up", () => {
      expect(retryItem([item({ status: "failed", attempts: 8, nextAttemptAt: 9, holdUntil: 9 })], "a")[0]).toMatchObject({
        status: "waiting",
        attempts: 0,
        nextAttemptAt: 0,
        holdUntil: null,
      });
      expect(retryItem([item({ attempts: 3, nextAttemptAt: 9 })], "a")[0]).toMatchObject({ attempts: 3, nextAttemptAt: 0 });
    });

    it("is ignored while the item is mid-send (one tap can't send twice)", () => {
      const q = [item({ status: "sending" })];
      expect(retryItem(q, "a")).toEqual(q);
      expect(isMidSend(q, "a")).toBe(true);
      expect(isMidSend(q, "b")).toBe(false);
    });
  });

  describe("wake (reconnect / app to front)", () => {
    it("skips the backoff for items never tried", () => {
      expect(wakeItems([item({ nextAttemptAt: 99_000 })])[0].nextAttemptAt).toBe(0);
    });

    it("never sooner than MIN_WAKE_GAP_MS after the last try, so a flapping connection can't loop", () => {
      const q = wakeItems([item({ nextAttemptAt: 99_000, lastTriedAt: 10_000 })]);
      expect(q[0].nextAttemptAt).toBe(10_000 + MIN_WAKE_GAP_MS);
    });

    it("keeps a server's Retry-After", () => {
      expect(wakeItems([item({ nextAttemptAt: 50_000, holdUntil: 50_000 })])[0].nextAttemptAt).toBe(50_000);
    });

    it("leaves failed and sending items alone", () => {
      const q = [item({ status: "failed", nextAttemptAt: 5 }), item({ id: "b", status: "sending", nextAttemptAt: 5 })];
      expect(wakeItems(q)).toEqual(q);
    });
  });

  it("next wake is the earliest waiting item of this person", () => {
    const q = [item({ nextAttemptAt: 50 }), item({ id: "b", nextAttemptAt: 20, userId: "u2" }), item({ id: "c", nextAttemptAt: 10, status: "failed" })];
    expect(nextWakeAtFor(q, "u1")).toBe(50);
    expect(nextWakeAtFor(q, "nobody")).toBeNull();
  });
});
