import QRCode from "qrcode";

const PNG_WIDTH = 768;

/** Absolute http(s) only. Relative paths and other schemes are not scannable. */
export function isAbsoluteHttpUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Ticket QR only for a saved, non-empty slug while ticketing is on.
 * An empty origin stays a relative path, so it returns null.
 */
export function ticketShareQrUrl(input: {
  origin: string;
  draftSlug: string;
  savedSlug: string | null;
  ticketingOn: boolean;
}): string | null {
  if (!input.ticketingOn) return null;
  const saved = input.savedSlug?.trim() ?? "";
  const draft = input.draftSlug.trim();
  if (!saved || draft !== saved) return null;
  const url = `${input.origin}/e/${saved}`;
  return isAbsoluteHttpUrl(url) ? url : null;
}

/**
 * Door QR only for a live token. Inactive, revoked, missing, or
 * not-yet-absolute links return null.
 */
export function doorShareQrUrl(input: {
  origin: string;
  token: string | null;
  active: boolean;
  revoked?: boolean;
}): string | null {
  if (!input.token || !input.active || input.revoked) return null;
  const url = `${input.origin}/scan/${input.token}`;
  return isAbsoluteHttpUrl(url) ? url : null;
}

const PNG_OPTIONS = {
  width: PNG_WIDTH,
  margin: 4,
  errorCorrectionLevel: "M" as const,
  color: { dark: "#000000", light: "#FFFFFF" },
};

/**
 * PNG of `url` at 768px with a 4-module quiet zone.
 * Browsers draw it on a canvas. The library's PNG encoder is the fallback
 * where canvas has no 2D context (tests).
 */
export async function shareQrPngDataUrl(url: string): Promise<string> {
  if (!isAbsoluteHttpUrl(url)) {
    throw new Error("A QR code needs an absolute http(s) link.");
  }
  if (typeof document !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      if (canvas.getContext("2d")) {
        await QRCode.toCanvas(canvas, url, PNG_OPTIONS);
        const dataUrl = canvas.toDataURL("image/png");
        if (dataUrl.length > "data:image/png;base64,".length) return dataUrl;
      }
    } catch {
      // The canvas path is best-effort. The encoder below is the same code.
    }
  }
  return QRCode.toDataURL(url, PNG_OPTIONS);
}

/** `<event-slug>-qr.png`, from a slug or the last segment of a share URL. */
export function shareQrFilename(source: string): string {
  const path = source.split(/[?#]/)[0] ?? source;
  const last = path.split("/").filter(Boolean).pop() ?? source;
  const safe = last
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${safe || "event"}-qr.png`;
}
