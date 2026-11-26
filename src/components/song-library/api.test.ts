import { afterEach, describe, expect, it, vi } from "vitest";
import { songLibraryApi, uploadVersion } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("uploadVersion", () => {
  it("requests a signed URL, PUTs the file, then records the version with { path }", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "idea.mp3", { type: "audio/mpeg" });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/song-library/songs/song-1/uploads") && method === "POST") {
        return jsonResponse(200, {
          path: "song-1/v-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.mp3",
          signed_url: "https://storage.example/signed",
          content_type: "audio/mpeg",
        });
      }
      if (url === "https://storage.example/signed" && method === "PUT") {
        return new Response(null, { status: 200 });
      }
      if (url.endsWith("/api/song-library/songs/song-1/versions") && method === "POST") {
        return jsonResponse(200, { version: { id: "ver-1" } });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(uploadVersion("song-1", file)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [uploadUrl, uploadInit] = fetchMock.mock.calls[0]!;
    expect(String(uploadUrl)).toBe("/api/song-library/songs/song-1/uploads");
    expect(uploadInit?.method).toBe("POST");
    expect(JSON.parse(String(uploadInit?.body))).toEqual({
      kind: "audio",
      filename: "idea.mp3",
      content_type: "audio/mpeg",
      size: 3,
    });
    const [putUrl, putInit] = fetchMock.mock.calls[1]!;
    expect(String(putUrl)).toBe("https://storage.example/signed");
    expect(putInit?.method).toBe("PUT");
    expect(putInit?.body).toBe(file);
    expect(new Headers(putInit?.headers).get("Content-Type")).toBe("audio/mpeg");
    const [versionUrl, versionInit] = fetchMock.mock.calls[2]!;
    expect(String(versionUrl)).toBe("/api/song-library/songs/song-1/versions");
    expect(versionInit?.method).toBe("POST");
    expect(versionInit?.body).not.toBeInstanceOf(FormData);
    expect(JSON.parse(String(versionInit?.body))).toEqual({ path: "song-1/v-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.mp3" });
  });

  it("returns the start-request code when the signed URL cannot be issued", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(415, { code: "use_signed_upload" })));
    const file = new File([new Uint8Array([1])], "idea.mp3", { type: "audio/mpeg" });
    await expect(uploadVersion("song-1", file)).resolves.toEqual({ ok: false, code: "use_signed_upload" });
  });

  it("returns upload_missing when the signed PUT does not finish", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/uploads")) {
        return jsonResponse(200, {
          path: "song-1/v-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.mp3",
          signed_url: "https://storage.example/signed",
          content_type: "audio/mpeg",
        });
      }
      if (url === "https://storage.example/signed") return new Response(null, { status: 500 });
      throw new Error(`unexpected ${init?.method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const file = new File([new Uint8Array([1])], "idea.mp3", { type: "audio/mpeg" });
    await expect(uploadVersion("song-1", file)).resolves.toEqual({ ok: false, code: "upload_missing" });
  });
});

describe("songLibraryApi moves and create", () => {
  it("sends the current stage or placement as from", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { song: { id: "song-1", stage: "refine" } }));
    vi.stubGlobal("fetch", fetchMock);
    await songLibraryApi.moveStage("song-1", "refine", "writing");
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ to: "refine", from: "writing" });
    await songLibraryApi.movePlacement("song-1", "ministry_nights", "inbox");
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({ to: "ministry_nights", from: "inbox" });
  });

  it("sends Hub co-writers as { user_id } and guests as { display_name }", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { song: { id: "song-1" } }));
    vi.stubGlobal("fetch", fetchMock);
    await songLibraryApi.upload({
      title: "Harbour Lights",
      entry_point: "melody",
      co_writers: [{ user_id: "11111111-1111-4111-8111-111111111111" }, { display_name: "Sana Byl" }],
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.co_writers).toEqual([{ user_id: "11111111-1111-4111-8111-111111111111" }, { display_name: "Sana Byl" }]);
  });
});
