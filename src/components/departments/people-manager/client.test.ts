import { afterEach, describe, expect, it, vi } from "vitest";
import { decisionBody, errorCopy, readOr, requestJson } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const SERVER_TEXT = "Already denied by Ben Okoro (secret server words)";

describe("errorCopy", () => {
  it("maps the leave codes to fixed copy", () => {
    expect(errorCopy("leave_request_already_decided")).toBe("Someone else decided this request first. Here's where it stands now.");
    expect(errorCopy("leave_request_decline_note_required")).toBe("Add a note to say why before you decline.");
    expect(errorCopy("leave_request_no_working_days")).toBe(
      "Those dates have no weekdays to take off. Weekends and public holidays aren't counted as leave."
    );
    expect(errorCopy("leave_request_not_approver")).toBe("Only another leader of this department, or an admin, can decide this request.");
    expect(errorCopy("leave_request_self_decision")).toBe("You can't decide your own request.");
    expect(errorCopy("leave_request_locked")).toBe("This request can't change any more.");
    expect(errorCopy("leave_request_type_not_available")).toBe("That type of leave isn't offered here any more. Pick another.");
    expect(errorCopy("unauthenticated")).toBe("Sign in again to continue.");
    expect(errorCopy("forbidden")).toBe("You don't have permission to do that.");
    expect(errorCopy("network")).toBe("No connection. Check your internet and try again.");
  });

  it("never uses the server's text: unknown input falls back to fixed copy", () => {
    expect(errorCopy(SERVER_TEXT)).toBe("That didn't work. Please try again.");
    expect(errorCopy(null)).toBe("That didn't work. Please try again.");
    expect(errorCopy(undefined)).toBe("That didn't work. Please try again.");
  });

  it("never says denied", () => {
    const codes = [
      "leave_request_already_decided",
      "leave_request_decline_note_required",
      "leave_request_locked",
      "leave_request_not_approver",
      "conflict",
    ];
    for (const c of codes) expect(errorCopy(c).toLowerCase()).not.toContain("denied");
  });
});

describe("requestJson", () => {
  it("returns only the code on a failure, never the server's error text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(409, { error: SERVER_TEXT, code: "leave_request_already_decided" })));
    const r = await requestJson("/api/x", { method: "POST", body: {} });
    expect(r).toEqual({ ok: false, status: 409, code: "leave_request_already_decided" });
    expect(JSON.stringify(r)).not.toContain("secret");
  });

  it("names a code from the status when the server sent none", async () => {
    const cases: [number, string][] = [
      [400, "invalid_input"],
      [401, "unauthenticated"],
      [403, "forbidden"],
      [404, "not_found"],
      [409, "conflict"],
    ];
    for (const [status, code] of cases) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(status, { error: SERVER_TEXT })));
      expect(await requestJson("/api/x")).toEqual({ ok: false, status, code });
    }
  });

  it("reports a network failure as code network", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await requestJson("/api/x")).toEqual({ ok: false, status: 0, code: "network" });
  });

  it("readOr flags 401/403 as denied, a 404 as missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, { error: "Not authorized" })));
    expect(await readOr("/api/x", "empty")).toEqual({ data: "empty", missing: true, denied: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { error: "Request not found" })));
    expect(await readOr("/api/x", "empty")).toEqual({ data: "empty", missing: true, denied: false });
  });
});

describe("decisionBody", () => {
  it("sends declined, never denied, with the note", () => {
    expect(decisionBody("declined", "  Outreach week  ")).toEqual({ decision: "declined", note: "Outreach week" });
    expect(JSON.stringify(decisionBody("declined", "x"))).not.toContain("denied");
  });

  it("refuses a decline without a note (null = don't send)", () => {
    expect(decisionBody("declined", "")).toBeNull();
    expect(decisionBody("declined", "   ")).toBeNull();
    expect(decisionBody("declined", null)).toBeNull();
  });

  it("approves with or without a note", () => {
    expect(decisionBody("approved")).toEqual({ decision: "approved" });
    expect(decisionBody("approved", "Rest up")).toEqual({ decision: "approved", note: "Rest up" });
  });
});
