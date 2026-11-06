import { describe, expect, it } from "vitest";
import { PHOTO_MAX_BYTES, VIDEO_MAX_BYTES } from "./contract";
import { assessUpload, sniffHeader } from "./media-bytes";

function bytes(...parts: Array<number | string>): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "number") out.push(part);
    else for (const char of part) out.push(char.charCodeAt(0));
  }
  return new Uint8Array(out);
}

describe("sniffHeader", () => {
  it("recognises the allowed photo and video types and rejects anything else", () => {
    expect(sniffHeader(bytes(0xff, 0xd8, 0xff, 0xe0))?.contentType).toBe("image/jpeg");
    expect(sniffHeader(bytes(0x89, "PNG\r\n\x1a\n"))?.contentType).toBe("image/png");
    expect(sniffHeader(bytes("RIFF", 0, 0, 0, 0, "WEBP"))?.contentType).toBe("image/webp");
    expect(sniffHeader(bytes(0, 0, 0, 0x18, "ftyp", "heic"))?.contentType).toBe("image/heic");
    expect(sniffHeader(bytes(0, 0, 0, 0x18, "ftyp", "isom"))?.contentType).toBe("video/mp4");
    expect(sniffHeader(bytes(0, 0, 0, 0x14, "ftyp", "qt  "))?.contentType).toBe("video/quicktime");
    expect(sniffHeader(bytes(0x1a, 0x45, 0xdf, 0xa3))?.contentType).toBe("video/webm");
    expect(sniffHeader(bytes("<html>"))).toBeNull();
    expect(sniffHeader(bytes("GIF89a"))).toBeNull();
  });
});

describe("assessUpload", () => {
  const jpeg = bytes(0xff, 0xd8, 0xff);

  it("rejects a declared photo whose bytes are a video, and a file over the cap", () => {
    const mp4 = bytes(0, 0, 0, 0x18, "ftyp", "isom");
    expect(assessUpload({ declaredKind: "photo", size: 100, header: mp4 }).ok).toBe(false);
    expect(assessUpload({ declaredKind: "photo", size: PHOTO_MAX_BYTES + 1, header: jpeg }).ok).toBe(false);
    expect(assessUpload({ declaredKind: "video", size: VIDEO_MAX_BYTES + 1, header: bytes(0x1a, 0x45, 0xdf, 0xa3) }).ok).toBe(false);
    const ok = assessUpload({ declaredKind: "photo", size: 1200, header: jpeg });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.contentType).toBe("image/jpeg");
  });
});
