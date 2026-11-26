import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { storeAdminClient } from "@/lib/store/db";
import { kindHasFlipbook } from "@/lib/store/catalogue";
import { formatMb, isAudioPathFor, MAX_AUDIO_BYTES, SIGNED_UPLOAD_TTL_SECONDS, validateAudioUpload } from "@/lib/store/upload";
import { getProduct, getProductAudio, setProductAudio } from "@/services/store";
import { readJson } from "../../../../_shared";
import { requireStoreStaff } from "../../../_guard";

// Optional background music for a product's flipbook. The file goes from
// the browser straight to the PRIVATE store-audio bucket on a signed upload
// URL, never through this route (Vercel's 4.5 MB body cap). See upload.ts.

async function flipbookProduct(supabase: unknown, id: string) {
  const { data: product } = await getProduct(supabase, id);
  if (!product) return { error: NextResponse.json({ error: "Product not found" }, { status: 404 }) };
  if (!kindHasFlipbook(product.kind)) return { error: NextResponse.json({ error: "Merch has no flipbook" }, { status: 400 }) };
  return { product };
}

// POST — step 1: { filename, contentType, size } → a signed upload token.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;
  const parsed = validateAudioUpload(await readJson(request));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, maxBytes: MAX_AUDIO_BYTES }, { status: parsed.status });
  const p = await flipbookProduct(guard.supabase, id);
  if (p.error) return p.error;

  // The storage path is ours, never the uploaded file name.
  const path = `${id}/${randomUUID()}.${parsed.value.ext}`;
  const { data: signed, error } = await storeAdminClient().storage.from("store-audio").createSignedUploadUrl(path, { upsert: false });
  if (error || !signed) return NextResponse.json({ error: error?.message ?? "Couldn't start the upload" }, { status: 500 });
  return NextResponse.json({ success: true, bucket: "store-audio", path, token: signed.token, maxBytes: MAX_AUDIO_BYTES, expiresIn: SIGNED_UPLOAD_TTL_SECONDS });
}

// PUT — step 3: { path } once the browser's upload landed. Checks the
// object, points the product at it and removes the music it replaces.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;
  const body = (await readJson(request)) as { path?: unknown } | null;
  const path = body?.path;
  if (!isAudioPathFor(id, path)) return NextResponse.json({ error: "That upload isn't for this product" }, { status: 400 });
  const p = await flipbookProduct(guard.supabase, id);
  if (p.error) return p.error;

  const admin = storeAdminClient();
  const { data: info } = await admin.storage.from("store-audio").info(path);
  const size = info ? ((info as { size?: number }).size ?? (info as { metadata?: { size?: number } }).metadata?.size ?? null) : null;
  if (typeof size !== "number") return NextResponse.json({ error: "The music didn't finish uploading. Upload it again." }, { status: 400 });
  if (size > MAX_AUDIO_BYTES) {
    await admin.storage.from("store-audio").remove([path]);
    return NextResponse.json({ error: `That file is over ${formatMb(MAX_AUDIO_BYTES)}.` }, { status: 400 });
  }

  const { data: before } = await getProductAudio(admin, id);
  const { error } = await setProductAudio(guard.supabase, id, path);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const old = before?.audio_path;
  if (old && old !== path) await admin.storage.from("store-audio").remove([old]);
  return NextResponse.json({ success: true, audio: path });
}

// DELETE — no music for this product.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireStoreStaff("manage");
  if (!guard.ok) return guard.response;
  const admin = storeAdminClient();
  const { data: before } = await getProductAudio(admin, id);
  if (!before) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  const { error } = await setProductAudio(guard.supabase, id, null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (before.audio_path) await admin.storage.from("store-audio").remove([before.audio_path]);
  return NextResponse.json({ success: true, audio: null });
}
