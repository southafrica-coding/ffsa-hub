import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bad, fleetAuth } from "@/lib/fleet/api";
import { insertFleetFile } from "@/services/fleet";

// Same types and size as the Fleet app (and the fleet-files bucket, migration 350).
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif", "application/pdf"];
const MAX_BYTES = 20 * 1024 * 1024;
const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf",
};
const OWNERS = ["vehicle", "inspection", "visit", "draft"];

// POST /api/vehicles/fleet/files — multipart upload of a photo or PDF into the private
// fleet-files bucket. Returns {id, url}; documents store the id, pages show the url.
export async function POST(request: Request) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("Expected multipart form data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return bad("No file provided");
  if (!ALLOWED.includes(file.type)) return bad("Photos (JPG, PNG, WEBP, HEIC) and PDFs only", 415);
  if (file.size > MAX_BYTES) return bad("Files can be 20 MB at most", 413);
  const ownerType = String(form.get("owner_type") || "");
  const ownerId = String(form.get("owner_id") || "").slice(0, 100) || null;

  const id = randomBytes(16).toString("hex");
  const path = `${ownerType && OWNERS.includes(ownerType) ? ownerType : "misc"}/${id}.${EXT[file.type] ?? "bin"}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  // Private bucket, no storage policies: written with the service role after the
  // access check above (as /api/vehicles/inspections/upload does).
  const admin = createAdminClient();
  const up = await admin.storage.from("fleet-files").upload(path, buffer, { contentType: file.type, upsert: false });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

  const { error } = await insertFleetFile(auth.supabase, {
    id,
    path,
    content_type: file.type,
    size_bytes: file.size,
    owner_type: OWNERS.includes(ownerType) ? ownerType : null,
    owner_id: ownerId,
    name: file.name.slice(0, 200) || null,
    created_by: auth.user.id,
  });
  if (error) {
    await admin.storage.from("fleet-files").remove([path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, id, url: `/api/vehicles/fleet/files/${id}`, contentType: file.type, sizeBytes: file.size });
}
