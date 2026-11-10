import QRCode from "qrcode";

const PNG_WIDTH = 768;

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
