import { ApiError } from "@/lib/api";

import {
  classifyError,
  deletionReducer,
  formatRequestedDate,
  initialDeletionState,
  isBusy,
  type DeletionEvent,
  type DeletionRequest,
  type DeletionState,
} from "../logic";

const REQ: DeletionRequest = { requestedAt: "2026-11-03T10:00:00Z", reason: null, recorded: true };

function run(events: DeletionEvent[], from: DeletionState = initialDeletionState) {
  return events.reduce(deletionReducer, from);
}

describe("deletionReducer", () => {
  it("loading → none when there's no request", () => {
    expect(run([{ type: "loaded", request: null }])).toEqual({ kind: "none", step: "idle", error: null });
  });

  it("loading → requested when one is open (a revisit, not just sent)", () => {
    expect(run([{ type: "loaded", request: REQ }])).toMatchObject({ kind: "requested", step: "idle", justSent: false });
  });

  it("loading → loadError, and load goes back to loading", () => {
    const failed = run([{ type: "loadFailed", error: "offline" }]);
    expect(failed).toEqual({ kind: "loadError", error: "offline" });
    expect(deletionReducer(failed, { type: "load" })).toEqual({ kind: "loading" });
  });

  it("a late load failure doesn't throw away a loaded screen", () => {
    const none = run([{ type: "loaded", request: null }]);
    expect(deletionReducer(none, { type: "loadFailed", error: "generic" })).toBe(none);
  });

  it("none → confirming → requesting → requested (the full happy path)", () => {
    const states: DeletionState[] = [];
    let s = initialDeletionState;
    for (const e of [
      { type: "loaded", request: null },
      { type: "openConfirm" },
      { type: "submit" },
      { type: "submitted", request: REQ },
    ] as DeletionEvent[]) {
      s = deletionReducer(s, e);
      states.push(s);
    }
    expect(states.map((x) => (x.kind === "none" || x.kind === "requested" ? `${x.kind}/${x.step}` : x.kind))).toEqual([
      "none/idle",
      "none/confirming",
      "none/requesting",
      "requested/idle",
    ]);
    expect(s).toMatchObject({ justSent: true, request: REQ });
  });

  it("never one tap: submit without the confirm step does nothing", () => {
    const none = run([{ type: "loaded", request: null }]);
    expect(deletionReducer(none, { type: "submit" })).toBe(none);
  });

  it("the sheet can't be closed while sending", () => {
    const sending = run([{ type: "loaded", request: null }, { type: "openConfirm" }, { type: "submit" }]);
    expect(deletionReducer(sending, { type: "closeConfirm" })).toBe(sending);
    expect(isBusy(sending)).toBe(true);
  });

  it("closing the confirm goes back to idle", () => {
    expect(run([{ type: "loaded", request: null }, { type: "openConfirm" }, { type: "closeConfirm" }])).toEqual({
      kind: "none",
      step: "idle",
      error: null,
    });
  });

  it("a failed send goes back to idle with the error; opening the confirm again clears it", () => {
    const failed = run([
      { type: "loaded", request: null },
      { type: "openConfirm" },
      { type: "submit" },
      { type: "submitFailed", error: "unavailable" },
    ]);
    expect(failed).toEqual({ kind: "none", step: "idle", error: "unavailable" });
    expect(deletionReducer(failed, { type: "openConfirm" })).toEqual({ kind: "none", step: "confirming", error: null });
  });

  it("requested → confirmingCancel → cancelling → none", () => {
    const s = run([{ type: "loaded", request: REQ }, { type: "openCancel" }, { type: "cancel" }]);
    expect(s).toMatchObject({ kind: "requested", step: "cancelling" });
    expect(isBusy(s)).toBe(true);
    expect(deletionReducer(s, { type: "cancelled" })).toEqual({ kind: "none", step: "idle", error: null });
  });

  it("cancel needs its confirm too", () => {
    const requested = run([{ type: "loaded", request: REQ }]);
    expect(deletionReducer(requested, { type: "cancel" })).toBe(requested);
  });

  it("a failed cancel keeps the request and shows the error", () => {
    const s = run([
      { type: "loaded", request: REQ },
      { type: "openCancel" },
      { type: "cancel" },
      { type: "cancelFailed", error: "cannotCancel" },
    ]);
    expect(s).toMatchObject({ kind: "requested", step: "idle", error: "cannotCancel", request: REQ });
  });

  it("closeCancel backs out", () => {
    expect(run([{ type: "loaded", request: REQ }, { type: "openCancel" }, { type: "closeCancel" }])).toMatchObject({
      kind: "requested",
      step: "idle",
    });
  });

  it("ignores events that don't belong to the current state", () => {
    const loading = initialDeletionState;
    expect(deletionReducer(loading, { type: "openConfirm" })).toBe(loading);
    const requested = run([{ type: "loaded", request: REQ }]);
    expect(deletionReducer(requested, { type: "openConfirm" })).toBe(requested);
    expect(deletionReducer(requested, { type: "cancelled" })).toBe(requested);
  });
});

describe("classifyError", () => {
  it.each([
    [new ApiError("network", "x"), "offline"],
    [new ApiError("timeout", "x"), "offline"],
    [new ApiError("forbidden", "x", 403), "forbidden"],
    [new ApiError("http", "x", 503), "unavailable"],
    [new ApiError("http", "x", 409), "cannotCancel"],
    [new ApiError("http", "x", 429), "tooMany"],
    [new ApiError("http", "x", 500), "generic"],
    [new ApiError("invalid_response", "x", 200), "generic"],
    [new Error("boom"), "generic"],
  ])("%s → %s", (err, kind) => {
    expect(classifyError(err)).toBe(kind);
  });
});

describe("formatRequestedDate", () => {
  it("reads as a South African date", () => {
    expect(formatRequestedDate("2026-11-03T10:00:00Z")).toBe("3 November 2026");
    // 23:30 UTC on the 3rd is already the 4th in Johannesburg.
    expect(formatRequestedDate("2026-11-03T23:30:00Z")).toBe("4 November 2026");
  });

  it("empty for nonsense", () => {
    expect(formatRequestedDate("not a date")).toBe("");
  });
});
