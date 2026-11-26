// ============================================================
// Store — PDF → page images
// ============================================================
// Renders every page of an uploaded PDF to a compressed WebP sized for
// phones. pdfjs-dist (legacy build, the one that runs in Node) draws onto
// an @napi-rs/canvas surface; sharp encodes the result. Server-only.
//
// Pages are stored CLEAN (no watermark) in the private store-pages bucket;
// the buyer's email is stamped on the way out by watermark.ts, so one
// render serves every buyer.
// ============================================================

import "server-only";
import path from "node:path";
import sharp from "sharp";

/** Width of a stored page. ~2x a 390px phone, which keeps text crisp on a
 *  retina screen while a typical magazine page stays near 100-200 KB. */
export const PAGE_WIDTH = 1080;
export const PAGE_QUALITY = 72;

export type RenderedPage = {
  pageNo: number;
  width: number;
  height: number;
  webp: Buffer;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfJs = any;

// PDFs that lean on the 14 standard fonts without embedding them need
// pdfjs's own font data; in Node it's read straight off disk. Traced into
// the serverless bundle by next.config.ts (outputFileTracingIncludes).
function standardFontDataUrl(): string {
  return path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts") + path.sep;
}

async function loadPdfJs(): Promise<PdfJs> {
  // Dynamic import: pdfjs is ESM-only and heavy; only the render route
  // and the admin upload pay for it.
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

export async function countPdfPages(pdf: Uint8Array): Promise<number> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false, isEvalSupported: false, standardFontDataUrl: standardFontDataUrl() }).promise;
  const n = doc.numPages as number;
  await doc.destroy();
  return n;
}

/**
 * Render pages of a PDF. `onPage` is called as each page finishes so the
 * caller can upload as it goes instead of holding every page in memory.
 */
export async function renderPdfToWebp(
  pdf: Uint8Array,
  opts: { width?: number; quality?: number; onPage?: (page: RenderedPage) => Promise<void> | void } = {}
): Promise<RenderedPage[]> {
  const width = opts.width ?? PAGE_WIDTH;
  const quality = opts.quality ?? PAGE_QUALITY;
  const pdfjs = await loadPdfJs();
  const { createCanvas } = await import("@napi-rs/canvas");

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdf),
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontDataUrl(),
  }).promise;

  const out: RenderedPage[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / base.width });
      const w = Math.round(viewport.width);
      const h = Math.round(viewport.height);
      const canvas = createCanvas(w, h);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, w, h);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const png = await canvas.encode("png");
      const webp = await sharp(png).webp({ quality, effort: 4 }).toBuffer();
      const rendered = { pageNo: i, width: w, height: h, webp };
      page.cleanup();
      if (opts.onPage) await opts.onPage(rendered);
      out.push(opts.onPage ? { ...rendered, webp: Buffer.alloc(0) } : rendered);
    }
  } finally {
    await doc.destroy();
  }
  return out;
}

/** Which pages are free previews by default: the first three. */
export function defaultPreviewPages(pageCount: number, n = 3): number[] {
  return Array.from({ length: Math.min(n, pageCount) }, (_, i) => i + 1);
}
