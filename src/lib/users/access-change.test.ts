import { describe, expect, it, vi } from "vitest";
import {
  accessChangeReducer,
  diffGrants,
  IDLE,
  isConfirming,
  membershipChangeTitle,
  postAccessChange,
  shownValue,
  type AccessChangeEvent,
  type AccessChangeState,
  type GrantRef,
} from "./access-change";

type M = "staff" | "student" | "community" | "none";

function run(...events: AccessChangeEvent<M>[]): AccessChangeState<M> {
  return events.reduce<AccessChangeState<M>>(
    (s, e) => accessChangeReducer(s, e),
    IDLE as AccessChangeState<M>
  );
}

const request: AccessChangeEvent<M> = {
  type: "request",
  key: "jane",
  from: "student",
  to: "staff",
};

describe("confirm-before-save state machine", () => {
  it("asking for a change opens the dialog but leaves the control on the saved value", () => {
    const s = run(request);
    expect(s.status).toBe("confirming");
    expect(isConfirming(s)).toBe(true);
    expect(shownValue(s, "jane", "student")).toBe("student");
  });

  it("Cancel closes the dialog and the control still shows the original value", () => {
    const s = run(request, { type: "cancel" });
    expect(s.status).toBe("idle");
    expect(isConfirming(s)).toBe(false);
    expect(shownValue(s, "jane", "student")).toBe("student");
  });

  it("Confirm moves the control to the new value while saving", () => {
    const s = run(request, { type: "confirm" });
    expect(s.status).toBe("saving");
    expect(shownValue(s, "jane", "student")).toBe("staff");
  });

  it("a successful save keeps the new value until the server data catches up", () => {
    const s = run(request, { type: "confirm" }, { type: "succeed" });
    expect(s.status).toBe("saved");
    expect(isConfirming(s)).toBe(false);
    expect(shownValue(s, "jane", "student")).toBe("staff");
    // …and once refreshed props say "staff", it agrees with them.
    expect(shownValue(s, "jane", "staff")).toBe("staff");
  });

  it("a failed save reverts the control to the saved value and keeps the error", () => {
    const s = run(request, { type: "confirm" }, { type: "fail", error: "Not authorized" });
    expect(s.status).toBe("failed");
    expect(s.status === "failed" && s.error).toBe("Not authorized");
    expect(shownValue(s, "jane", "student")).toBe("student");
  });

  it("only the row being changed is affected", () => {
    const s = run(request, { type: "confirm" });
    expect(shownValue(s, "someone-else", "community")).toBe("community");
  });

  it("re-picking the current value is not a change and opens nothing", () => {
    const s = run({ type: "request", key: "jane", from: "staff", to: "staff" });
    expect(s.status).toBe("idle");
  });

  it("Cancel and a new request are ignored while a save is in flight", () => {
    const saving = run(request, { type: "confirm" });
    expect(accessChangeReducer(saving, { type: "cancel" })).toBe(saving);
    expect(
      accessChangeReducer(saving, { type: "request", key: "bob", from: "none", to: "staff" })
    ).toBe(saving);
  });

  it("Confirm without an open dialog does nothing", () => {
    expect(run({ type: "confirm" }).status).toBe("idle");
    expect(run(request, { type: "cancel" }, { type: "confirm" }).status).toBe("idle");
  });
});

describe("postAccessChange", () => {
  const ok = () => vi.fn(async () => new Response("{}", { status: 200 }));

  it("posts JSON and reports success", async () => {
    const f = ok();
    const r = await postAccessChange("/api/x", { a: 1 }, "fallback", f as typeof fetch);
    expect(r).toEqual({ ok: true });
    expect(f).toHaveBeenCalledWith(
      "/api/x",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ a: 1 }) })
    );
  });

  it("surfaces the server's error message", async () => {
    const f = vi.fn(
      async () => new Response(JSON.stringify({ error: "Not authorized" }), { status: 403 })
    );
    expect(await postAccessChange("/api/x", {}, "fallback", f as typeof fetch)).toEqual({
      ok: false,
      error: "Not authorized",
    });
  });

  it("falls back when the error body is unreadable", async () => {
    const f = vi.fn(async () => new Response("<html>", { status: 500 }));
    expect(await postAccessChange("/api/x", {}, "Could not save", f as typeof fetch)).toEqual({
      ok: false,
      error: "Could not save",
    });
  });

  it("turns a network failure into an error instead of throwing", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const r = await postAccessChange("/api/x", {}, "Could not save", f as typeof fetch);
    expect(r.ok).toBe(false);
  });
});

describe("wording", () => {
  it("says plainly what will change and for whom", () => {
    expect(membershipChangeTitle("Jane Doe", "Student", "Staff")).toBe(
      "Change Jane Doe's membership role from Student to Staff?"
    );
  });
});

describe("diffGrants", () => {
  const ref = (id: string, scope: string | null = null): GrantRef => ({
    permission_id: id,
    scope_type: scope ? "program" : null,
    scope_id: scope,
  });
  const editable = new Map<string, GrantRef>([
    ["a", ref("a")],
    ["b", ref("b")],
    ["c", ref("c", "dts")],
  ]);

  it("lists only what was ticked or unticked", () => {
    const { toGrant, toRevoke } = diffGrants(editable, new Set(["a", "c"]), new Set(["a", "b"]));
    expect(toGrant).toEqual([ref("b")]);
    expect(toRevoke).toEqual([ref("c", "dts")]);
  });

  it("never emits a change outside what the editor may touch", () => {
    const { toGrant, toRevoke } = diffGrants(
      editable,
      new Set(["hidden-saved"]),
      new Set(["hidden-new"])
    );
    expect(toGrant).toEqual([]);
    expect(toRevoke).toEqual([]);
  });
});
