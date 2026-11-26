// Shared by /complete (after the browser's direct upload) and /render
// (retry): check the object in Storage, claim the asset, and render it in
// the background with after(). The request answers 202 straight away; the
// admin page polls GET /api/store/admin/assets/[id].
import { after, NextResponse } from "next/server";
import { storeAdminClient } from "@/lib/store/db";
import { processUploadedAsset } from "@/lib/store/pdf/process-asset";
import { checkStoredObject, RENDER_STALE_MS, uploadWindowOpen } from "@/lib/store/upload";
import type { StoreAsset } from "@/lib/store/types";
import { claimAssetForRender, getAsset, updateAsset } from "@/services/store";
import { requireStoreStaff } from "../_guard";

export async function startRender(id: string, from: StoreAsset["status"][]) {
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;
  const { data: asset } = (await getAsset(guard.supabase, id)) as { data: StoreAsset | null };
  if (!asset) return NextResponse.json({ error: "Upload not found" }, { status: 404 });

  const admin = storeAdminClient();
  // The signed upload window (SIGNED_UPLOAD_TTL_SECONDS) is ours to enforce.
  if (asset.status === "awaiting_upload" && !uploadWindowOpen(asset.created_at)) {
    const error = "The upload link expired. Upload the PDF again.";
    await updateAsset(admin, id, { status: "failed", error });
    return NextResponse.json({ error }, { status: 410 });
  }
  // A render killed by the function timeout leaves "rendering" behind; let
  // a retry take it over once it's clearly dead.
  const stale = asset.status === "rendering" && asset.render_started_at && Date.now() - Date.parse(asset.render_started_at) > RENDER_STALE_MS;
  const allowed = stale ? [...from, "rendering"] : from;
  if (!allowed.includes(asset.status)) {
    return NextResponse.json({ error: asset.status === "rendering" ? "It's already making the pages" : `This upload is ${asset.status}` }, { status: 409 });
  }

  // The browser said how big the file was when it asked to upload; check
  // the object that actually landed (and that it landed at all).
  const { data: info } = await admin.storage.from("store-source").info(asset.source_path);
  const stored = info ? { size: (info as { size?: number; metadata?: { size?: number } }).size ?? (info as { metadata?: { size?: number } }).metadata?.size ?? null } : null;
  const check = checkStoredObject(stored, asset.byte_size);
  if (!check.ok) {
    await updateAsset(admin, id, { status: "failed", error: check.error });
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const { data: claimed } = await claimAssetForRender(admin, id, allowed);
  if (!claimed) return NextResponse.json({ error: "It's already making the pages" }, { status: 409 });

  after(async () => {
    const result = await processUploadedAsset(admin, claimed);
    if (!result.ok) console.error(`[store] render ${id} failed: ${result.error}`);
  });
  return NextResponse.json({ success: true, status: "rendering" }, { status: 202 });
}
