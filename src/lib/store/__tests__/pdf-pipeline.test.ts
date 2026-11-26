import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { countPdfPages, defaultPreviewPages, renderPdfToWebp } from "../pdf/render";
import { buildLowResPdf } from "../pdf/low-res-pdf";

const sample = new Uint8Array(readFileSync(path.join(__dirname, "../fixtures/sample-review.pdf")));

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

  it("builds a clean low-res PDF: no watermark, no buyer details", { timeout: 60_000 }, async () => {
    const pages = await renderPdfToWebp(sample, { width: 540 });
    const bytes = await buildLowResPdf(pages.map((p) => p.webp), "Example Review");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(4);
    expect(doc.getTitle()).toBe("Example Review");
    expect(doc.getSubject()).toBeUndefined();
    expect(doc.getKeywords()).toBeUndefined();
    // One image per page and nothing drawn over it.
    const raw = Buffer.from(bytes).toString("latin1");
    expect(raw).not.toMatch(/licensed/i);
    expect(raw).not.toMatch(/@example\.org/);
    expect(raw).not.toMatch(/\/Font/);
    // Low-res: far smaller than shipping 4 full-size pages.
    expect(bytes.length).toBeLessThan(600_000);
  });
});
