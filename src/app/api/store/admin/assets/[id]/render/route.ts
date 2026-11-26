import { NextResponse } from "next/server";
import { storeAdminClient } from "@/lib/store/db";
import { defaultPreviewPages, renderPdfToWebp } from "@/lib/store/pdf/render";
import { activateAsset, getAsset, updateAsset, upsertPages } from "@/services/store";
import { requireStoreStaff } from "../../../_guard";

export const runtime = "nodejs";
// A 60-page magazine renders in well under a minute; give it room.
export const maxDuration = 300;

// POST /api/store/admin/assets/[id]/render — turn the uploaded PDF into
// WebP pages in the private store-pages bucket, mark the first three as
// previews, and make this the product's live PDF.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;
  const { data: asset } = await getAsset(guard.supabase, id);
  if (!asset) return NextResponse.json({ error: "Upload not found" }, { status: 404 });

  const admin = storeAdminClient();
  await updateAsset(admin, id, { status: "rendering", error: null });
  try {
    const { data: file, error: dlErr } = await admin.storage.from("store-source").download(asset.source_path);
    if (dlErr || !file) throw new Error("The PDF didn't finish uploading. Upload it again.");
    const pdf = new Uint8Array(await file.arrayBuffer());
    if (!(pdf[0] === 0x25 && pdf[1] === 0x50 && pdf[2] === 0x44 && pdf[3] === 0x46)) throw new Error("That file isn't a PDF.");

    const bucket = admin.storage.from("store-pages");
    const rows: Array<{ asset_id: string; page_no: number; path: string; width: number; height: number; is_preview: boolean }> = [];
    await renderPdfToWebp(pdf, {
      onPage: async (page) => {
        const path = `${id}/${String(page.pageNo).padStart(4, "0")}.webp`;
        const up = await bucket.upload(path, page.webp, { contentType: "image/webp", upsert: true });
        if (up.error) throw new Error(`Page ${page.pageNo} didn't save: ${up.error.message}`);
        rows.push({ asset_id: id, page_no: page.pageNo, path, width: page.width, height: page.height, is_preview: false });
      },
    });
    if (rows.length === 0) throw new Error("That PDF has no pages.");
    const previews = new Set(defaultPreviewPages(rows.length));
    for (const r of rows) r.is_preview = previews.has(r.page_no);
    const { error: pErr } = await upsertPages(admin, rows);
    if (pErr) throw new Error(pErr.message);

    await updateAsset(admin, id, { status: "ready", page_count: rows.length, ready_at: new Date().toISOString() });
    const { error: aErr } = await activateAsset(admin, asset.product_id, id);
    if (aErr) throw new Error(aErr.message);
    return NextResponse.json({ success: true, pages: rows.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Rendering failed";
    await updateAsset(admin, id, { status: "failed", error: message.slice(0, 500) });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
