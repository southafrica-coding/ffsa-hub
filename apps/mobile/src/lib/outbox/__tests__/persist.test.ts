import { isBaseItem, parseStore, serializeStore, STORE_VERSION } from "../persist";
import type { BaseItem } from "../queue";

const item = (over: Partial<BaseItem> = {}): BaseItem => ({
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
const any = () => true;

describe("outbox storage format", () => {
  it("writes a versioned envelope", () => {
    expect(JSON.parse(serializeStore([item()]))).toEqual({ version: STORE_VERSION, items: [item()] });
  });

  it("nothing stored is an empty queue with no problem", () => {
    expect(parseStore(null, any)).toEqual({ items: [], problem: null });
    expect(parseStore("", any)).toEqual({ items: [], problem: null });
  });

  it("reads version 2 and upgrades version 1 (a bare array), filling new fields", () => {
    const v2 = parseStore(serializeStore([item()]), any);
    expect(v2.problem).toBeNull();
    expect(v2.items[0]).toMatchObject({ id: "a", lastTriedAt: null, holdUntil: null, maybeSent: false });
    const v1 = parseStore(JSON.stringify([item(), item({ id: "b" })]), any);
    expect(v1).toMatchObject({ problem: null, items: [{ id: "a" }, { id: "b" }] });
    // Tests hand the parsed value straight in.
    expect(parseStore([item()], any).items).toHaveLength(1);
  });

  it("unreadable text is reported as corrupt, never as a quiet empty queue", () => {
    expect(parseStore("{not json", any)).toEqual({ items: [], problem: "corrupt" });
    expect(parseStore('{"hello":1}', any)).toEqual({ items: [], problem: "corrupt" });
    expect(parseStore("42", any)).toEqual({ items: [], problem: "corrupt" });
  });

  it("keeps every item it can read and reports the rest", () => {
    const raw = JSON.stringify({ version: 2, items: [item(), { id: 7 }, item({ id: "b", status: "nonsense" as never }), item({ id: "c" })] });
    expect(parseStore(raw, any)).toMatchObject({ problem: "partial", items: [{ id: "a" }, { id: "c" }] });
  });

  it("applies the queue's own check too", () => {
    const res = parseStore(JSON.stringify([item(), item({ id: "b", kind: "other" })]), (v) => v.kind === "thing");
    expect(res).toMatchObject({ problem: "partial", items: [{ id: "a" }] });
  });

  it("a file from a newer app version is read but flagged, so the original is kept aside", () => {
    expect(parseStore(JSON.stringify({ version: 99, items: [item()] }), any)).toMatchObject({ problem: "partial", items: [{ id: "a" }] });
  });

  it("base item check", () => {
    expect(isBaseItem(item())).toBe(true);
    expect(isBaseItem(item({ lastError: "x" }))).toBe(true);
    expect(isBaseItem({ ...item(), id: "" })).toBe(false);
    expect(isBaseItem({ ...item(), attempts: "1" })).toBe(false);
    expect(isBaseItem({ ...item(), createdAt: Number.NaN })).toBe(false);
    expect(isBaseItem(null)).toBe(false);
  });
});
