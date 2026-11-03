import AsyncStorage from "@react-native-async-storage/async-storage";

import { ApiError } from "@/lib/api";

import {
  flushQueue,
  loadQueue,
  pendingFor,
  queueKey,
  queueReducer,
  rejectedFor,
  saveQueue,
  type QueueAction,
  type QueuedScan,
} from "../offline-queue";

const at = "2026-11-03T09:00:00.000Z";
const enq = (id: string, code = `CODE-${id}`, eventId = "e1"): QueueAction => ({ type: "enqueue", id, eventId, code, at });
const run = (actions: QueueAction[], start: QueuedScan[] = []) => actions.reduce(queueReducer, start);

describe("queueReducer (state machine)", () => {
  it("enqueues as pending, once per event+code", () => {
    const q = run([enq("1", "AAAA"), enq("2", "AAAA"), enq("3", "AAAA", "e2")]);
    expect(q.map((x) => [x.id, x.state])).toEqual([
      ["1", "pending"],
      ["3", "pending"],
    ]);
  });

  it("pending → sending → confirmed on ok or already-in", () => {
    let q = run([enq("1"), enq("2"), { type: "sending", id: "1" }, { type: "sending", id: "2" }]);
    expect(q.every((x) => x.state === "sending")).toBe(true);
    q = run(
      [
        { type: "answered", id: "1", outcome: { result: "ok", ticketId: "t", ticketTypeName: "G", buyerName: "B" } },
        { type: "answered", id: "2", outcome: { result: "already_checked_in", ticketTypeName: "G", checkedInAt: null } },
      ],
      q,
    );
    expect(q.map((x) => x.state)).toEqual(["confirmed", "confirmed"]);
    expect(q[0].attempts).toBe(1);
  });

  it("sending → rejected when the server says no", () => {
    const q = run([enq("1"), { type: "sending", id: "1" }, { type: "answered", id: "1", outcome: { result: "wrong_event" } }]);
    expect(q[0]).toMatchObject({ state: "rejected", outcome: { result: "wrong_event" } });
    expect(rejectedFor(q, "e1")).toHaveLength(1);
    expect(pendingFor(q, "e1")).toHaveLength(0);
  });

  it("sending → pending on a failure, counting attempts", () => {
    const q = run([enq("1"), { type: "sending", id: "1" }, { type: "failed", id: "1", error: "offline" }]);
    expect(q[0]).toMatchObject({ state: "pending", attempts: 1, lastError: "offline" });
  });

  it("ignores answers for items that aren't being sent", () => {
    const q = run([enq("1"), { type: "answered", id: "1", outcome: { result: "invalid" } }]);
    expect(q[0].state).toBe("pending");
  });

  it("dismiss removes finished items but never unsent ones", () => {
    let q = run([enq("1"), enq("2"), { type: "sending", id: "2" }, { type: "answered", id: "2", outcome: { result: "void" } }]);
    q = run([{ type: "dismiss", id: "1" }, { type: "dismiss", id: "2" }], q);
    expect(q.map((x) => x.id)).toEqual(["1"]);
  });

  it("restore puts an interrupted send back to pending", () => {
    const q = run([enq("1"), { type: "sending", id: "1" }, { type: "restore" }]);
    expect(q[0].state).toBe("pending");
  });

  it("load merges saved items before ones queued meanwhile", () => {
    const saved = run([enq("old"), { type: "sending", id: "old" }]);
    const q = run([enq("new"), { type: "load", items: saved }]);
    expect(q.map((x) => [x.id, x.state])).toEqual([
      ["old", "pending"],
      ["new", "pending"],
    ]);
  });
});

describe("storage", () => {
  beforeEach(() => AsyncStorage.clear());

  it("round-trips per user and drops confirmed items", async () => {
    const q = run([
      enq("1"),
      enq("2"),
      { type: "sending", id: "2" },
      { type: "answered", id: "2", outcome: { result: "ok", ticketId: "t", ticketTypeName: "G", buyerName: "" } },
      enq("3"),
      { type: "sending", id: "3" },
    ]);
    await saveQueue("u1", q);
    const back = await loadQueue("u1");
    expect(back.map((x) => [x.id, x.state])).toEqual([
      ["1", "pending"],
      ["3", "pending"],
    ]);
    expect(await loadQueue("someone-else")).toEqual([]);
  });

  it("reads corrupt storage as empty, never a crash", async () => {
    await AsyncStorage.setItem(queueKey("u1"), "{not json");
    expect(await loadQueue("u1")).toEqual([]);
    await AsyncStorage.setItem(queueKey("u1"), JSON.stringify([{ id: 1 }]));
    expect(await loadQueue("u1")).toEqual([]);
  });
});

describe("flushQueue", () => {
  function harness(start: QueuedScan[]) {
    let q = start;
    const dispatch = (a: QueueAction) => {
      q = queueReducer(q, a);
    };
    return { dispatch, get: () => q };
  }

  it("sends each pending scan for the event, in order", async () => {
    const h = harness(run([enq("1", "AAAA"), enq("2", "BBBB"), enq("3", "CCCC", "other-event")]));
    const checkIn = jest
      .fn()
      .mockResolvedValueOnce({ result: "ok", ticketId: "t1", ticketTypeName: "G", buyerName: "" })
      .mockResolvedValueOnce({ result: "invalid" });
    const answered = await flushQueue(h.get(), "e1", { checkIn }, h.dispatch);
    expect(answered).toBe(2);
    expect(checkIn.mock.calls.map((c) => c[0])).toEqual(["AAAA", "BBBB"]);
    expect(h.get().map((x) => x.state)).toEqual(["confirmed", "rejected", "pending"]);
  });

  it("stops at the first connection failure and keeps the rest queued", async () => {
    const h = harness(run([enq("1", "AAAA"), enq("2", "BBBB")]));
    const checkIn = jest.fn().mockRejectedValue(new ApiError("network", "offline"));
    expect(await flushQueue(h.get(), "e1", { checkIn }, h.dispatch)).toBe(0);
    expect(checkIn).toHaveBeenCalledTimes(1);
    expect(h.get().map((x) => x.state)).toEqual(["pending", "pending"]);
  });

  it("keeps going past a non-connection error (that item stays pending)", async () => {
    const h = harness(run([enq("1", "AAAA"), enq("2", "BBBB")]));
    const checkIn = jest
      .fn()
      .mockRejectedValueOnce(new ApiError("http", "boom", 500))
      .mockResolvedValueOnce({ result: "ok", ticketId: "t", ticketTypeName: "G", buyerName: "" });
    await flushQueue(h.get(), "e1", { checkIn }, h.dispatch);
    expect(h.get().map((x) => x.state)).toEqual(["pending", "confirmed"]);
  });
});
