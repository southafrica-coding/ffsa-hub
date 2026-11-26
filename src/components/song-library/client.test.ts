import { afterEach, describe, expect, it, vi } from "vitest";
import { readOr } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("readOr", () => {
  it("returns the payload when the read succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { ok: true })));
    await expect(readOr("/api/x", { empty: true })).resolves.toEqual({ data: { ok: true }, missing: false, denied: false });
  });

  it("flags a 403 or forbidden code as denied, not as an empty catalogue", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, { code: "forbidden" })));
    await expect(readOr("/api/x", "empty")).resolves.toEqual({ data: "empty", missing: true, denied: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, {})));
    await expect(readOr("/api/x", "empty")).resolves.toEqual({ data: "empty", missing: true, denied: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { code: "forbidden" })));
    // 200 with a body is success; denial is status 403 or a failed response whose code is forbidden / "403"
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { code: "forbidden" })));
    await expect(readOr("/api/x", "empty")).resolves.toEqual({ data: "empty", missing: true, denied: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { code: "403" })));
    await expect(readOr("/api/x", "empty")).resolves.toEqual({ data: "empty", missing: true, denied: true });
  });

  it("treats a missing route as empty, not as no access", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { code: "not_found" })));
    await expect(readOr("/api/x", "empty")).resolves.toEqual({ data: "empty", missing: true, denied: false });
  });
});
