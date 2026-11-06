import { maxBytesFor, type MediaKind } from "./contract";

// Server-side check of an uploaded object. The sign route already rejects a
// declared type or size that is out of bounds. Create reads the object's
// real size and the first bytes, and does not trust the client.

const PHOTO_MAX_LABEL = "Photos must be 15 MB or smaller.";
const VIDEO_MAX_LABEL = "Videos must be 250 MB or smaller.";

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[start + i] ?? 0);
  return out;
}

export function sniffHeader(bytes: Uint8Array): { kind: MediaKind; contentType: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { kind: "photo", contentType: "image/jpeg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { kind: "photo", contentType: "image/png" };
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { kind: "photo", contentType: "image/webp" };
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { kind: "video", contentType: "video/webm" };
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (["heic", "heix", "hevc", "heif", "mif1", "msf1"].includes(brand)) {
      return { kind: "photo", contentType: brand === "heif" || brand === "mif1" ? "image/heif" : "image/heic" };
    }
    if (brand === "qt  ") return { kind: "video", contentType: "video/quicktime" };
    if (["isom", "iso2", "mp41", "mp42", "avc1", "M4V ", "dash", "MSNV"].includes(brand)) {
      return { kind: "video", contentType: "video/mp4" };
    }
  }
  return null;
}

export function assessUpload(input: {
  declaredKind: MediaKind;
  size: number;
  header: Uint8Array;
}): { ok: true; kind: MediaKind; contentType: string; size: number } | { ok: false; message: string } {
  if (!Number.isInteger(input.size) || input.size <= 0) {
    return { ok: false, message: "The uploaded file is empty." };
  }
  const sniffed = sniffHeader(input.header);
  if (!sniffed || sniffed.kind !== input.declaredKind) {
    return { ok: false, message: "That file is not an allowed photo or video." };
  }
  if (input.size > maxBytesFor(sniffed.kind)) {
    return { ok: false, message: sniffed.kind === "photo" ? PHOTO_MAX_LABEL : VIDEO_MAX_LABEL };
  }
  return { ok: true, kind: sniffed.kind, contentType: sniffed.contentType, size: input.size };
}
