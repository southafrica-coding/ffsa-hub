import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { getVehicleAccess } from "@/services/vehicles";

/**
 * A person's passport page photo, held on their profile (migration 242).
 *
 * Every driver on a vehicle booking must have one; the booking pulls it from
 * here rather than asking again. Same audience as the licence: the person
 * themselves and the vehicles team (approve / manage).
 *
 * Lives in the private 'vehicle-inspections' bucket under
 * user-passports/<user_id>/…, only ever read back through a signed URL.
 */

const BUCKET = "vehicle-inspections";
const SIGNED_TTL = 3600;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/heic", "application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024;
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

async function resolveTarget(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  const asked = new URL(request.url).searchParams.get("user_id");
  if (!asked || asked === user.id) return { error: null, userId: user.id };
  const access = await getVehicleAccess(supabase, user.id);
  if (!(access.canApprove || access.canManage)) {
    return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  return { error: null, userId: asked };
}

// GET — the photo on file, with a fresh signed URL.
export async function GET(request: Request) {
  const t = await resolveTarget(request);
  if (t.error) return t.error;
  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data } = await admin
    .from("users")
    .select("passport_file_url, passport_file_name, passport_uploaded_at")
    .eq("id", t.userId)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "User not found" }, { status: 404 });

  let signed_url: string | null = null;
  if (data.passport_file_url) {
    const { data: s } = await admin.storage.from(BUCKET).createSignedUrl(data.passport_file_url, SIGNED_TTL);
    signed_url = s?.signedUrl ?? null;
  }
  return NextResponse.json({
    passport: {
      has_file: !!data.passport_file_url,
      file_name: data.passport_file_name,
      uploaded_at: data.passport_uploaded_at,
      signed_url,
    },
  });
}

// POST — multipart upload (or replacement).
export async function POST(request: Request) {
  const t = await resolveTarget(request);
  if (t.error) return t.error;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: "File must be an image (PNG/JPG/WEBP/HEIC) or PDF" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File must be 10 MB or smaller" }, { status: 400 });

  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: existing } = await admin
    .from("users")
    .select("passport_file_url")
    .eq("id", t.userId)
    .maybeSingle();

  const path = `user-passports/${t.userId}/${Date.now()}.${EXT[file.type] ?? "bin"}`;
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { error } = await admin
    .from("users")
    .update({ passport_file_url: path, passport_file_name: file.name, passport_uploaded_at: new Date().toISOString() })
    .eq("id", t.userId);
  if (error) {
    await admin.storage.from(BUCKET).remove([path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (existing?.passport_file_url) await admin.storage.from(BUCKET).remove([existing.passport_file_url]);

  const { data: s } = await admin.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
  return NextResponse.json({ ok: true, file_name: file.name, signed_url: s?.signedUrl ?? null });
}

// DELETE — remove the photo.
export async function DELETE(request: Request) {
  const t = await resolveTarget(request);
  if (t.error) return t.error;
  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: existing } = await admin
    .from("users")
    .select("passport_file_url")
    .eq("id", t.userId)
    .maybeSingle();
  const { error } = await admin
    .from("users")
    .update({ passport_file_url: null, passport_file_name: null, passport_uploaded_at: null })
    .eq("id", t.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (existing?.passport_file_url) await admin.storage.from(BUCKET).remove([existing.passport_file_url]);
  return NextResponse.json({ ok: true });
}
