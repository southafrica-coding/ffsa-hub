// Builds src/lib/store/fixtures/sample-review.pdf — a clearly fake,
// four-page placeholder used by the Store's render/watermark test.
// Run: node scripts/store/make-sample-pdf.mjs
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync } from "node:fs";

const doc = await PDFDocument.create();
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const regular = await doc.embedFont(StandardFonts.Helvetica);
const W = 420, H = 595; // A5 portrait, points
const shades = [rgb(0.04, 0.04, 0.04), rgb(0.96, 0.95, 0.92), rgb(1, 0.72, 0), rgb(0.96, 0.95, 0.92)];
for (let i = 0; i < 4; i++) {
  const page = doc.addPage([W, H]);
  const dark = i === 0;
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: shades[i] });
  const ink = dark ? rgb(1, 1, 1) : rgb(0.04, 0.04, 0.04);
  page.drawText("EXAMPLE YEAR-END REVIEW", { x: 32, y: H - 70, size: 22, font: bold, color: ink });
  page.drawText(`Sample page ${i + 1} of 4`, { x: 32, y: H - 96, size: 12, font: regular, color: ink });
  page.drawText("Placeholder content. Not a real publication.", { x: 32, y: 60, size: 10, font: regular, color: ink });
  for (let l = 0; l < 12; l++) {
    page.drawRectangle({ x: 32, y: H - 160 - l * 26, width: W - 64 - (l % 3) * 40, height: 8, color: dark ? rgb(0.3, 0.3, 0.3) : rgb(0.8, 0.78, 0.7) });
  }
}
doc.setTitle("Example Year-End Review — sample");
writeFileSync(new URL("../../src/lib/store/fixtures/sample-review.pdf", import.meta.url), await doc.save());
console.log("wrote sample-review.pdf");
