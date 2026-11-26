/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, toast, uploadToSignedUrl } = vi.hoisted(() => ({
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  uploadToSignedUrl: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl }) } }),
}));

import { AudioUpload } from "./editors";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PRODUCT = "3f00ea86-a269-4bd5-ae9d-fec6f91a01a6";
const MPEG_BYTES = 6_857_857; // ~6.9 MB, same size as the Entering Autumn MP3

let host: HTMLDivElement, root: Root | null = null;
function render(current: { url: string } | null = null) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<AudioUpload productId={PRODUCT} current={current} />));
}
function input() {
  return host.querySelector('input[type="file"]') as HTMLInputElement;
}
function fileListOf(file: File): FileList {
  return { 0: file, length: 1, item: (i: number) => (i === 0 ? file : null), [Symbol.iterator]: function* () { yield file; } } as unknown as FileList;
}
async function choose(file: File) {
  const el = input();
  expect(el).toBeTruthy();
  expect(el.disabled).toBe(false);
  Object.defineProperty(el, "files", { configurable: true, value: fileListOf(file) });
  await act(async () => {
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
const respond = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  refresh.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  uploadToSignedUrl.mockReset();
  uploadToSignedUrl.mockResolvedValue({ error: null });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("AudioUpload", () => {
  it("wires htmlFor to the file input so a click reaches onChange", () => {
    render();
    const el = input();
    const label = host.querySelector("label");
    expect(el.id).toBeTruthy();
    expect(label?.getAttribute("for") ?? label?.htmlFor).toBe(el.id);
    expect(el.disabled).toBe(false);
  });

  it("an audio/mpeg file of about 6.9 MB starts the signed upload, not a route-body POST", async () => {
    render();
    const file = new File([new Uint8Array(MPEG_BYTES)], "Patrick_Davies_-_Entering_Autumn.mp3", { type: "audio/mpeg" });
    expect(file.size).toBe(MPEG_BYTES);
    expect(file.size).toBeGreaterThan(4.5 * 1024 * 1024);
    respond(200, { bucket: "store-audio", path: `${PRODUCT}/aaaaaaaa-0000-4000-8000-000000000001.mp3`, token: "tok" });
    respond(200, { success: true });
    await choose(file);

    expect(toast.error).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const start = fetchMock.mock.calls[0];
    expect(start[0]).toBe(`/api/store/admin/products/${PRODUCT}/audio`);
    expect(start[1]).toMatchObject({ method: "POST" });
    const startBody = JSON.parse((start[1] as RequestInit).body as string);
    expect(startBody).toEqual({
      filename: "Patrick_Davies_-_Entering_Autumn.mp3",
      contentType: "audio/mpeg",
      size: MPEG_BYTES,
    });
    // JSON only — the file itself is not the request body.
    expect((start[1] as RequestInit).body).not.toBeInstanceOf(FormData);
    expect(uploadToSignedUrl).toHaveBeenCalledTimes(1);
    const upArgs = uploadToSignedUrl.mock.calls[0];
    expect(upArgs[0]).toBe(`${PRODUCT}/aaaaaaaa-0000-4000-8000-000000000001.mp3`);
    expect(upArgs[1]).toBe("tok");
    expect(upArgs[2]).toBe(file);
    expect(upArgs[3]).toEqual({ contentType: "audio/mpeg" });
    const done = fetchMock.mock.calls[1];
    expect(done[1]).toMatchObject({ method: "PUT" });
    expect(JSON.parse((done[1] as RequestInit).body as string)).toEqual({
      path: `${PRODUCT}/aaaaaaaa-0000-4000-8000-000000000001.mp3`,
    });
    expect(toast.success).toHaveBeenCalledWith("Music saved");
  });

  it("still uploads an MP3 when the browser leaves file.type empty", async () => {
    render();
    const file = new File([new Uint8Array(MPEG_BYTES)], "Patrick_Davies_-_Entering_Autumn.mp3", { type: "" });
    respond(200, { bucket: "store-audio", path: `${PRODUCT}/bbbbbbbb-0000-4000-8000-000000000002.mp3`, token: "tok" });
    respond(200, { success: true });
    await choose(file);
    expect(toast.error).not.toHaveBeenCalled();
    const startBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(startBody.contentType).toBe("audio/mpeg");
    expect(uploadToSignedUrl).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Music saved");
  });

  it("toasts when no file is chosen", async () => {
    render();
    const el = input();
    Object.defineProperty(el, "files", { configurable: true, value: { length: 0, item: () => null } });
    await act(async () => {
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(toast.error).toHaveBeenCalledWith("Choose an audio file to upload.");
    expect(host.querySelector("[role='alert']")?.textContent).toBe("Choose an audio file to upload.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("toasts when the file is not audio", async () => {
    render();
    await choose(new File([new Uint8Array(16)], "notes.pdf", { type: "application/pdf" }));
    expect(toast.error).toHaveBeenCalledWith("That isn't an audio file. Use MP3, M4A, WAV or OGG.");
    expect(host.querySelector("[role='alert']")?.textContent).toMatch(/isn't an audio file/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("toasts when the file is over the 20 MB limit", async () => {
    render();
    const tooBig = new File([new Uint8Array(20 * 1024 * 1024 + 1)], "long.mp3", { type: "audio/mpeg" });
    await choose(tooBig);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(String(toast.error.mock.calls[0][0])).toMatch(/20\.0 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("toasts when the signed-upload start route refuses", async () => {
    render();
    respond(400, { error: "Merch has no flipbook" });
    await choose(new File([new Uint8Array(1024)], "song.mp3", { type: "audio/mpeg" }));
    expect(toast.error).toHaveBeenCalledWith("Merch has no flipbook");
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("toasts when the Storage PUT fails", async () => {
    render();
    respond(200, { bucket: "store-audio", path: `${PRODUCT}/c.mp3`, token: "tok" });
    uploadToSignedUrl.mockResolvedValueOnce({ error: { message: "Bucket not found" } });
    await choose(new File([new Uint8Array(1024)], "song.mp3", { type: "audio/mpeg" }));
    expect(toast.error).toHaveBeenCalledWith("Bucket not found");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("toasts when confirming the upload fails", async () => {
    render();
    respond(200, { bucket: "store-audio", path: `${PRODUCT}/d.mp3`, token: "tok" });
    respond(500, { error: "Couldn't save the music" });
    await choose(new File([new Uint8Array(1024)], "song.mp3", { type: "audio/mpeg" }));
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the music");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
