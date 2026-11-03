// How big a receipt photo should be before it leaves the phone. Pure maths,
// so it's tested without a camera. Phone cameras take 12–48 MP photos; a
// receipt stays readable at 1600px on its long edge and drops to a few
// hundred KB as JPEG 0.7, which matters on outreach-field mobile data.

export const RECEIPT_MAX_EDGE = 1600;
export const RECEIPT_JPEG_QUALITY = 0.7;

export type ResizePlan = { resize: { width: number } | { height: number } | null; compress: number };

/**
 * Resize only when the long edge is over the limit (never upscale), keeping
 * the aspect ratio by fixing just the long edge. Unknown sizes (0 from some
 * pickers) are re-encoded without resizing rather than guessed at.
 */
export function planReceiptResize(width: number, height: number, maxEdge = RECEIPT_MAX_EDGE): ResizePlan {
  const w = Number.isFinite(width) ? width : 0;
  const h = Number.isFinite(height) ? height : 0;
  if (w <= 0 || h <= 0 || Math.max(w, h) <= maxEdge) return { resize: null, compress: RECEIPT_JPEG_QUALITY };
  return {
    resize: w >= h ? { width: maxEdge } : { height: maxEdge },
    compress: RECEIPT_JPEG_QUALITY,
  };
}

/** The size the plan produces (for tests and for the upload's metadata). */
export function plannedSize(width: number, height: number, maxEdge = RECEIPT_MAX_EDGE): { width: number; height: number } {
  const plan = planReceiptResize(width, height, maxEdge);
  if (!plan.resize) return { width, height };
  if ("width" in plan.resize) return { width: maxEdge, height: Math.round((height * maxEdge) / width) };
  return { width: Math.round((width * maxEdge) / height), height: maxEdge };
}

/** A file name safe for a storage path: letters, digits, dot, dash, underscore. */
export function safeFileName(name: string | null | undefined, fallback = "receipt.jpg"): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(-80);
  if (!cleaned || cleaned.startsWith(".")) return fallback;
  // Compressed output is always JPEG.
  return /\.(jpe?g)$/i.test(cleaned) ? cleaned : `${cleaned.replace(/\.[A-Za-z0-9]+$/, "")}.jpg`;
}
