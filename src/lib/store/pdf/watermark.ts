// ============================================================
// Store — watermarks
// ============================================================
// Every page a buyer sees carries "Licensed to <email>": a light diagonal
// repeat across the page plus a small solid footer line. Drawn with
// @napi-rs/canvas using the repo's own Roboto Condensed (no system fonts
// on Vercel), composited onto the stored WebP by sharp.
//
// Honest limits: this discourages sharing and identifies a leak; it can't
// stop a screenshot. The reader copy says so.
// ============================================================

import "server-only";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument, rgb } from "pdf-lib";

const FONT_FAMILY = "StoreWatermark";
let fontReady: Promise<void> | null = null;

async function ensureFont() {
  fontReady ??= (async () => {
    const { GlobalFonts } = await import("@napi-rs/canvas");
    const file = path.join(process.cwd(), "public/brand/fonts/RobotoCondensed-Bold.ttf");
    GlobalFonts.registerFromPath(file, FONT_FAMILY);
  })();
  return fontReady;
}

export function watermarkText(email: string): string {
  return `Licensed to ${email.trim().toLowerCase()}`;
}

/** A transparent PNG the size of the page carrying the watermark. */
export async function watermarkOverlay(width: number, height: number, label: string): Promise<Buffer> {
  await ensureFont();
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Diagonal repeat — light enough to read through. Dark fill for light
  // pages plus a faint light outline so it still shows on dark photo
  // spreads (the 2026 Review is mostly dark photography).
  const size = Math.max(14, Math.round(width / 36));
  ctx.font = `${size}px ${FONT_FAMILY}`;
  ctx.fillStyle = "rgba(10,10,10,0.07)";
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = Math.max(1, size / 24);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 6);
  const step = size * 7;
  const textW = ctx.measureText(label).width + size * 3;
  const reach = Math.hypot(width, height);
  for (let y = -reach / 2; y < reach / 2; y += step) {
    const offset = (Math.round(y / step) % 2) * (textW / 2);
    for (let x = -reach / 2 - offset; x < reach / 2; x += textW) {
      ctx.fillText(label, x, y);
      ctx.strokeText(label, x, y);
    }
  }
  ctx.restore();

  // Footer line — always legible, on a white tab so it survives dark pages.
  const small = Math.max(11, Math.round(width / 70));
  ctx.font = `${small}px ${FONT_FAMILY}`;
  const footW = ctx.measureText(label).width + small * 1.4;
  const footH = small * 1.8;
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.fillRect(width - footW - small, height - footH - small * 0.6, footW, footH);
  ctx.fillStyle = "rgba(10,10,10,0.78)";
  ctx.fillText(label, width - footW - small + small * 0.7, height - small * 0.6 - footH / 2 + small * 0.36);

  return canvas.encode("png");
}

/** Stamp a stored page for one reader. Returns WebP. */
export async function watermarkPage(webp: Buffer, label: string): Promise<Buffer> {
  const img = sharp(webp);
  const meta = await img.metadata();
  const width = meta.width ?? 1080;
  const height = meta.height ?? 1527;
  const overlay = await watermarkOverlay(width, height, label);
  return img.composite([{ input: overlay, top: 0, left: 0 }]).webp({ quality: 74 }).toBuffer();
}

/**
 * The Print + Digital PDF: low-res (~110 dpi on A4) JPEG pages with the
 * watermark burned in, plus the label as PDF metadata. Never the source.
 */
export async function buildWatermarkedPdf(pages: Buffer[], email: string, title: string): Promise<Uint8Array> {
  const label = watermarkText(email);
  const doc = await PDFDocument.create();
  doc.setTitle(`${title} — ${label}`);
  doc.setSubject(label);
  doc.setKeywords([label]);
  doc.setProducer("FFSA Hub Store");
  for (const webp of pages) {
    const stamped = await watermarkPage(await sharp(webp).resize({ width: 900, withoutEnlargement: true }).webp().toBuffer(), label);
    const jpg = await sharp(stamped).jpeg({ quality: 62 }).toBuffer();
    const image = await doc.embedJpg(jpg);
    // 72pt per inch; draw at ~A-series proportions, width 595pt.
    const w = 595;
    const h = Math.round((image.height / image.width) * w);
    const page = doc.addPage([w, h]);
    page.drawImage(image, { x: 0, y: 0, width: w, height: h });
    page.drawText(label, { x: 12, y: 8, size: 6, color: rgb(0.35, 0.35, 0.35), opacity: 0.8 });
  }
  return doc.save();
}
