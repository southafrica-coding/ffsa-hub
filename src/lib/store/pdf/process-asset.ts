// ============================================================
// Store — render an uploaded PDF into flipbook pages (background job)
// ============================================================
// Runs after the browser has PUT the PDF straight into the private
// store-source bucket (see src/lib/store/upload.ts for why it never goes
// through a route). Called from `after()` in the complete / render routes,
// so the admin's request returns at once and the admin page polls.
//
// Memory: pdfjs needs the whole source PDF in memory (up to MAX_PDF_BYTES),
// but pages are rendered one at a time and uploaded as they finish, so only
// one page image is held at once. Page rows are written in batches, and
// page_count moves as it goes so the admin sees progress.
// ============================================================

import "server-only";
import type { StoreClient } from "@/lib/store/db";
import type { StoreAsset } from "@/lib/store/types";
import { activateAsset, updateAsset, upsertPages } from "@/services/store";
import { defaultPreviewPages, renderPdfToWebp } from "./render";

const BATCH = 5;

type PageRow = { asset_id: string; page_no: number; path: string; width: number; height: number; is_preview: boolean };

export function isPdfBytes(b: Uint8Array): boolean {
  return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
}

/**
 * Render `asset` (already claimed: status "rendering") into store-pages and
 * make it the product's live PDF. Never throws: failure is recorded on the
 * asset row, which is what the admin page shows.
 */
export async function processUploadedAsset(
  admin: StoreClient,
  asset: Pick<StoreAsset, "id" | "product_id" | "source_path">,
  opts: { width?: number } = {}
): Promise<{ ok: true; pages: number } | { ok: false; error: string }> {
  const id = asset.id;
  try {
    const { data: file, error: dlErr } = await admin.storage.from("store-source").download(asset.source_path);
    if (dlErr || !file) throw new Error("The PDF didn't finish uploading. Upload it again.");
    const pdf = new Uint8Array(await file.arrayBuffer());
    if (!isPdfBytes(pdf)) throw new Error("That file isn't a PDF.");

    const bucket = admin.storage.from("store-pages");
    const previews = new Set<number>();
    let pending: PageRow[] = [];
    let done = 0;
    let total = 0;

    const flush = async () => {
      if (pending.length === 0) return;
      const { error } = await upsertPages(admin, pending);
      if (error) throw new Error(error.message);
      pending = [];
      await updateAsset(admin, id, { page_count: done });
    };

    await renderPdfToWebp(pdf, {
      width: opts.width,
      onStart: (n) => {
        total = n;
        for (const p of defaultPreviewPages(n)) previews.add(p);
      },
      onPage: async (page) => {
        const path = `${id}/${String(page.pageNo).padStart(4, "0")}.webp`;
        const up = await bucket.upload(path, page.webp, { contentType: "image/webp", upsert: true });
        if (up.error) throw new Error(`Page ${page.pageNo} didn't save: ${up.error.message}`);
        pending.push({ asset_id: id, page_no: page.pageNo, path, width: page.width, height: page.height, is_preview: previews.has(page.pageNo) });
        done++;
        if (pending.length >= BATCH) await flush();
      },
    });
    await flush();
    if (total === 0 || done === 0) throw new Error("That PDF has no pages.");

    const { error: rErr } = await updateAsset(admin, id, { status: "ready", page_count: done, ready_at: new Date().toISOString() });
    if (rErr) throw new Error(rErr.message);
    const { error: aErr } = await activateAsset(admin, asset.product_id, id);
    if (aErr) throw new Error(aErr.message);
    return { ok: true, pages: done };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Rendering failed";
    await updateAsset(admin, id, { status: "failed", error: message.slice(0, 500) });
    return { ok: false, error: message };
  }
}
