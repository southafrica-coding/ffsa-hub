import { describe, expect, it } from "vitest";
import {
  LISTING_PHOTO_MAX_BYTES,
  listingPhotoProblem,
  readListingPhotoUpload,
} from "./photos";

function file(type: string, size = 4, name = "mic.bin") {
  return new File([new Uint8Array(size)], name, { type });
}

async function read(body: FormData | string) {
  const request =
    typeof body === "string"
      ? new Request("http://x", { method: "POST", body, headers: { "content-type": "text/plain" } })
      : new Request("http://x", { method: "POST", body });
  return readListingPhotoUpload(request);
}

describe("listing photo upload", () => {
  it("accepts jpg, png, and webp", () => {
    expect(listingPhotoProblem(file("image/jpeg"))).toBeNull();
    expect(listingPhotoProblem(file("image/png"))).toBeNull();
    expect(listingPhotoProblem(file("image/webp"))).toBeNull();
  });

  it("rejects other types and files over 8 MB", () => {
    expect(listingPhotoProblem(file("image/gif"))).toMatch(/JPG, PNG or WEBP/);
    expect(listingPhotoProblem(file("image/jpeg", LISTING_PHOTO_MAX_BYTES + 1))).toMatch(/8 MB/);
  });

  it("reads a file and leaves alt unset when the form has none", async () => {
    const form = new FormData();
    form.append("file", file("image/jpeg", 4, "mic.jpg"));
    const upload = await read(form);
    expect(upload).toMatchObject({ ext: "jpg" });
    expect("alt" in upload).toBe(false);
  });

  it("keeps a trimmed alt when the editor sent one", async () => {
    const form = new FormData();
    form.append("file", file("image/png", 4, "mic.png"));
    form.append("alt", "  Front  ");
    const upload = await read(form);
    expect(upload).toMatchObject({ ext: "png", alt: "Front" });
  });

  it("turns a blank alt into null", async () => {
    const form = new FormData();
    form.append("file", file("image/webp", 4, "mic.webp"));
    form.append("alt", "   ");
    const upload = await read(form);
    expect(upload).toMatchObject({ ext: "webp", alt: null });
  });

  it("rejects a body that is not a photo", async () => {
    const form = new FormData();
    form.append("note", "hello");
    expect(await read(form)).toMatchObject({ status: 400, error: "No file provided" });
    expect(await read("not a form")).toMatchObject({ status: 400 });
  });
});
