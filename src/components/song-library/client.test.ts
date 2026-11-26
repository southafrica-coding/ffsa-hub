import { afterEach, describe, expect, it, vi } from "vitest";
import { errorCopy, readOr } from "./client";

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


describe("errorCopy", () => {
  it("maps known codes to fixed copy and never uses the server's text", () => {
    expect(errorCopy("forbidden")).toBe("You don't have permission to do that.");
    expect(errorCopy("stage_not_allowed")).toBe("You can't move this song to that stage.");
    expect(errorCopy("splits_not_100")).toBe("Splits must add up to 100% before credits can be agreed.");
    expect(errorCopy("credits_agreed")).toBe("Credits are agreed. Undo the agreement before changing writers or splits.");
    expect(errorCopy("invalid_input")).toBe("Check the details and try again.");
    expect(errorCopy("check_failed")).toBe("Check the details and try again.");
    expect(errorCopy("duplicate")).toBe("That already exists.");
    expect(errorCopy("too_large")).toBe("That file is too big. Try a shorter clip or an mp3.");
    expect(errorCopy("song_moved")).toBe("Someone else moved this song first. We'll refresh it.");
    expect(errorCopy("help_closed")).toBe("This help request is no longer open.");
    expect(errorCopy("upload_missing")).toBe("The file didn't finish uploading. Try again.");
    expect(errorCopy("use_signed_upload")).toBe("This file has to be uploaded to a signed URL. Try again.");
    expect(errorCopy("Someone moved this song first")).toBe("That didn't save. Please try again.");
  });
});
