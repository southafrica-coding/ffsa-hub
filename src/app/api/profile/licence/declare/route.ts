import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import { getLicenceBlock, type LicenceKind } from "@/lib/users/licence-gate";

/**
 * Answer the licence gate.
 *
 * Always about the CALLER — unlike /api/profile/licence, there is no
 * `user_id` parameter here. This endpoint lifts a block on whoever calls it,
 * so letting it target someone else would let one user clear another's gate.
 *
 * Multipart because the licence photo comes with the answer: the gate has to
 * be satisfiable in one action, and a two-step "save then upload" would leave
 * people stuck behind the overlay if the second step failed.
 */

const BUCKET = "vehicle-inspections";
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/heic", "application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024;
const KINDS: LicenceKind[] = ["sa", "international", "none"];

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(String(form.get("payload") ?? "{}"));
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const kind = String(payload.licence_kind ?? "") as LicenceKind;
  if (!KINDS.includes(kind)) {
    return NextResponse.json(
      { error: "Please say whether you hold a driver's licence." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // "I don't hold one" clears the gate and wipes any stale licence detail
  // from a previous answer, so the profile can't claim both at once.
  if (kind === "none") {
    const { error } = await admin
      .from("users")
      .update({
        licence_kind: "none",
        licence_declared_at: now,
        drivers_licence_number: null,
        licence_country: null,
        licence_code: null,
        licence_expiry_date: null,
        licence_no_expiry: false,
        has_international_permit: false,
        international_permit_expiry: null,
      })
      .eq("id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const number = String(payload.drivers_licence_number ?? "").trim();
  const country =
    kind === "sa" ? "ZA" : String(payload.licence_country ?? "").trim().toUpperCase();
  const code = String(payload.licence_code ?? "").trim() || null;
  const noExpiry = !!payload.licence_no_expiry;
  const expiryRaw = payload.licence_expiry_date;
  const expiry = noExpiry ? null : String(expiryRaw ?? "").trim();

  if (!number) {
    return NextResponse.json({ error: "Please enter your licence number." }, { status: 400 });
  }
  if (kind === "international" && !country) {
    return NextResponse.json(
      { error: "Please choose the country that issued your licence." },
      { status: 400 }
    );
  }
  if (!noExpiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry ?? "")) {
    return NextResponse.json(
      { error: "Please enter the expiry date, or tick that your licence has none." },
      { status: 400 }
    );
  }

  // The photo is required to satisfy the gate, but only when there isn't one
  // already: someone re-answering to fix a missing expiry shouldn't have to
  // re-photograph a card the Hub already holds.
  const { data: existing } = await admin
    .from("users")
    .select("licence_file_url")
    .eq("id", user.id)
    .maybeSingle();

  const file = form.get("file");
  let path: string | null = (existing?.licence_file_url as string | null) ?? null;

  if (file instanceof File) {
    if (!ALLOWED.includes(file.type)) {
      return NextResponse.json(
        { error: "File must be an image (PNG/JPG/WEBP/HEIC) or PDF" },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File must be 10 MB or smaller" }, { status: 400 });
    }
    const next = `user-licenses/${user.id}/${Date.now()}.${EXT[file.type] ?? "bin"}`;
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(next, file, { contentType: file.type, upsert: false });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    const previous = path;
    path = next;
    // Only drop the old file once the new one is safely up.
    if (previous) await admin.storage.from(BUCKET).remove([previous]);
  }

  if (!path) {
    return NextResponse.json(
      { error: "Please attach a photo of your licence." },
      { status: 400 }
    );
  }

  const patch = {
    licence_kind: kind,
    licence_declared_at: now,
    drivers_licence_number: number,
    licence_country: country,
    licence_code: code,
    licence_expiry_date: expiry,
    licence_no_expiry: noExpiry,
    has_international_permit:
      kind === "international" && !!payload.has_international_permit,
    international_permit_expiry:
      kind === "international" && payload.international_permit_expiry
        ? String(payload.international_permit_expiry)
        : null,
    licence_file_url: path,
    licence_file_name: file instanceof File ? file.name : undefined,
    licence_uploaded_at: file instanceof File ? now : undefined,
    licence_uploaded_by: file instanceof File ? user.id : undefined,
  };
  // Drop the undefined keys so a re-answer without a new file doesn't blank
  // the existing file's metadata.
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined)
  );

  const { error } = await admin.from("users").update(clean).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Belt and braces: if this somehow doesn't satisfy the gate, say so now
  // rather than bouncing them straight back into the overlay.
  const stillBlocked = getLicenceBlock({ ...clean, licence_file_url: path });
  if (stillBlocked) {
    return NextResponse.json(
      { error: `Still needed: ${stillBlocked.missing.join(", ")}.` },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
