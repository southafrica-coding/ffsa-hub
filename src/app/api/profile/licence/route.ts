import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { getVehicleAccess } from "@/services/vehicles";

/**
 * A person's driver's licence, held on their profile instead of re-uploaded
 * into every booking.
 *
 * Who may see the image: the person themselves, and the vehicles team
 * (approve / manage). Deliberately NOT every admin — this is an identity
 * document held for one operational purpose, so the audience is the people
 * who run the fleet, not everyone with an admin flag.
 *
 * The file lives in the private 'vehicle-inspections' bucket from 104 under
 * user-licenses/<user_id>/…; it is only ever read back through a signed URL
 * minted here.
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

/** The target user for this request: yourself, or someone the fleet team may act for. */
async function resolveTarget(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  const url = new URL(request.url);
  const asked = url.searchParams.get("user_id");
  if (!asked || asked === user.id) {
    return { error: null, supabase, userId: user.id, self: true };
  }
  const access = await getVehicleAccess(supabase, user.id);
  if (!(access.canApprove || access.canManage)) {
    return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  return { error: null, supabase, userId: asked, self: false };
}

// GET — the licence on file, with a fresh signed URL when there is a file.
export async function GET(request: Request) {
  const t = await resolveTarget(request);
  if (t.error) return t.error;

  const admin = createAdminClient();
  const { data } = await admin
    .from("users")
    .select(
      "drivers_licence_number, licence_country, licence_code, licence_expiry_date, licence_file_name, licence_file_url, base_driving_test_status, base_driving_test_passed_at, licence_kind, licence_no_expiry"
    )
    .eq("id", t.userId)
    .maybeSingle();

  if (!data) return NextResponse.json({ error: "User not found" }, { status: 404 });

  let signed_url: string | null = null;
  if (data.licence_file_url) {
    const { data: s } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(data.licence_file_url, SIGNED_TTL);
    signed_url = s?.signedUrl ?? null;
  }

  // The storage path is an internal detail — hand back the signed URL only.
  const { licence_file_url: _path, ...rest } = data;
  return NextResponse.json({ licence: { ...rest, has_file: !!_path, signed_url } });
}

// PUT — save the typed licence details (number, country, code, expiry).
export async function PUT(request: Request) {
  const t = await resolveTarget(request);
  if (t.error) return t.error;

  const body = await request.json().catch(() => ({}));
  const number = String(body.drivers_licence_number ?? "").trim();
  const country = String(body.licence_country ?? "").trim();
  const code = String(body.licence_code ?? "").trim();
  const expiry = String(body.licence_expiry_date ?? "").trim();
  const noExpiry = !!body.licence_no_expiry;

  if (!number) {
    return NextResponse.json({ error: "Please enter your licence number." }, { status: 400 });
  }
  // A licence with no printed expiry (real in some countries) has nothing to
  // enter here — demanding a date would leave those holders unable to save.
  if (!noExpiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    return NextResponse.json({ error: "Please enter the licence expiry date." }, { status: 400 });
  }
  // An already-expired licence is accepted and stored: refusing it would leave
  // the profile blank, which reads as "never had one". Booking is where the
  // expiry actually blocks, and it can then say WHY.

  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update({
      drivers_licence_number: number,
      licence_country: country || null,
      licence_code: code || null,
      licence_expiry_date: noExpiry ? null : expiry,
      licence_no_expiry: noExpiry,
    })
    .eq("id", t.userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// POST — multipart upload (or replacement) of the licence image/PDF.
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
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json(
      { error: "File must be an image (PNG/JPG/WEBP/HEIC) or PDF" },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File must be 10 MB or smaller" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("users")
    .select("licence_file_url")
    .eq("id", t.userId)
    .maybeSingle();

  const path = `user-licenses/${t.userId}/${Date.now()}.${EXT[file.type] ?? "bin"}`;
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { error } = await admin
    .from("users")
    .update({
      licence_file_url: path,
      licence_file_name: file.name,
      licence_uploaded_at: new Date().toISOString(),
      licence_uploaded_by: t.userId,
    })
    .eq("id", t.userId);
  if (error) {
    await admin.storage.from(BUCKET).remove([path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Drop the superseded file only after the row points at the new one, so a
  // failure here leaves an orphan rather than a profile with no licence.
  if (existing?.licence_file_url) {
    await admin.storage.from(BUCKET).remove([existing.licence_file_url]);
  }

  const { data: s } = await admin.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
  return NextResponse.json({
    ok: true,
    file_name: file.name,
    signed_url: s?.signedUrl ?? null,
  });
}

// DELETE — remove the licence file (the typed details stay).
export async function DELETE(request: Request) {
  const t = await resolveTarget(request);
  if (t.error) return t.error;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("users")
    .select("licence_file_url")
    .eq("id", t.userId)
    .maybeSingle();

  const { error } = await admin
    .from("users")
    .update({
      licence_file_url: null,
      licence_file_name: null,
      licence_uploaded_at: null,
      licence_uploaded_by: null,
    })
    .eq("id", t.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (existing?.licence_file_url) {
    await admin.storage.from(BUCKET).remove([existing.licence_file_url]);
  }
  return NextResponse.json({ ok: true });
}
