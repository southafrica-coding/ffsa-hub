// ============================================================
// Store — the Print + Digital PDF
// ============================================================
// A low-res PDF built from the stored page images: no watermark, no
// overlay, no footer and nothing about the buyer in its metadata. The
// private source PDF is never shipped.
// ============================================================

import "server-only";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

/**
 * Low-res (~110 dpi on A4) JPEG pages built from the stored WebP pages.
 * The same file for every buyer of an asset.
 */
export async function buildLowResPdf(pages: Buffer[], title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer("FFSA Hub Store");
  for (const webp of pages) {
    const jpg = await sharp(webp).resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 62 }).toBuffer();
    const image = await doc.embedJpg(jpg);
    // 72pt per inch; draw at ~A-series proportions, width 595pt.
    const w = 595;
    const h = Math.round((image.height / image.width) * w);
    const page = doc.addPage([w, h]);
    page.drawImage(image, { x: 0, y: 0, width: w, height: h });
  }
  return doc.save();
}
