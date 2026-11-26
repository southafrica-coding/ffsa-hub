import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { countPdfPages, defaultPreviewPages, renderPdfToWebp } from "../pdf/render";
import { buildWatermarkedPdf, watermarkPage, watermarkText } from "../pdf/watermark";

const sample = new Uint8Array(readFileSync(path.join(__dirname, "../fixtures/sample-review.pdf")));

async function meanDiff(a: Buffer, b: Buffer): Promise<number> {
  const [ra, rb] = await Promise.all([
    sharp(a).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  expect(ra.info.width).toBe(rb.info.width);
  let sum = 0;
  for (let i = 0; i < ra.data.length; i++) sum += Math.abs(ra.data[i] - rb.data[i]);
  return sum / ra.data.length;
}

describe("Store PDF pipeline on the sample Review", () => {
  it("counts pages and picks the first three as previews", async () => {
    expect(await countPdfPages(sample)).toBe(4);
    expect(defaultPreviewPages(4)).toEqual([1, 2, 3]);
    expect(defaultPreviewPages(2)).toEqual([1, 2]);
  });

  it("renders every page to a phone-sized WebP", { timeout: 60_000 }, async () => {
    const pages = await renderPdfToWebp(sample, { width: 540 });
    expect(pages.map((p) => p.pageNo)).toEqual([1, 2, 3, 4]);
    for (const p of pages) {
      const meta = await sharp(p.webp).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(540);
      expect(p.height).toBeGreaterThan(p.width); // A5 portrait
      expect(p.webp.length).toBeLessThan(200_000);
    }
    // Page 1 is the dark cover: the render really drew the PDF, not a blank.
    const stats = await sharp(pages[0].webp).stats();
    expect(stats.channels[0].mean).toBeLessThan(80);
  });

  it("stamps a visible, per-buyer watermark", { timeout: 60_000 }, async () => {
    const [page] = await renderPdfToWebp(sample, { width: 540 });
    const a = await watermarkPage(page.webp, watermarkText("Reader.One@example.org"));
    const b = await watermarkPage(page.webp, watermarkText("reader.two@example.org"));
    expect(watermarkText("Reader.One@example.org")).toBe("Licensed to reader.one@example.org");
    expect((await sharp(a).metadata()).format).toBe("webp");
    expect(await meanDiff(page.webp, a)).toBeGreaterThan(0.2); // changed the page
    expect(await meanDiff(a, b)).toBeGreaterThan(0.05); // different buyer, different stamp
  });

  it("builds a low-res watermarked PDF with the buyer in its metadata", { timeout: 60_000 }, async () => {
    const pages = await renderPdfToWebp(sample, { width: 540 });
    const bytes = await buildWatermarkedPdf(pages.map((p) => p.webp), "reader.one@example.org", "Example Review");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(4);
    expect(doc.getSubject()).toBe("Licensed to reader.one@example.org");
    expect(doc.getTitle()).toContain("Licensed to reader.one@example.org");
    // Low-res: far smaller than shipping 4 full-size pages.
    expect(bytes.length).toBeLessThan(600_000);
  });
});
