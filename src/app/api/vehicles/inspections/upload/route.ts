import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getVehicleAccess,
  getVehicleBookingOwner,
  insertInspectionFile,
} from "@/services/vehicles";

const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/heic", "application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — matches the bucket limit.

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

// POST /api/vehicles/inspections/upload — multipart upload of a damage photo
// or driver licence into the private 'vehicle-inspections' bucket.
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

  const file = form.get("file");
  const bookingId = (form.get("booking_id") as string | null)?.trim() || null;
  const kindRaw = (form.get("kind") as string | null)?.trim();
  const kind = kindRaw === "license" ? "license" : "damage_photo";
  const inspectionId = (form.get("inspection_id") as string | null)?.trim() || null;

  if (!bookingId) return NextResponse.json({ error: "booking_id is required" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json(
      { error: "File must be an image (PNG/JPG/WEBP/HEIC) or PDF" },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File must be 10 MB or smaller" }, { status: 400 });
  }

  // Authorize against the booking (managers, or the booking's requester).
  const access = await getVehicleAccess(supabase, user.id);
  const { data: booking } = await getVehicleBookingOwner(supabase, bookingId);
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  const isManager = access.isAdmin || access.canApprove || access.canManage;
  if (!isManager && booking.requested_by !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const admin = createAdminClient();
  const ext = EXT[file.type] ?? "bin";
  const path = `${bookingId}/${kind}/${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const upload = await admin.storage
    .from("vehicle-inspections")
    .upload(path, buffer, { contentType: file.type, upsert: false });
  if (upload.error) {
    return NextResponse.json({ error: upload.error.message }, { status: 500 });
  }

  const { data, error } = await insertInspectionFile(supabase, {
    vehicle_booking_id: bookingId,
    inspection_id: inspectionId,
    kind,
    file_path: path,
    file_name: file.name,
    uploaded_by: user.id,
  });
  if (error) {
    // Roll back the orphaned object if the metadata insert fails.
    await admin.storage.from("vehicle-inspections").remove([path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: signed } = await admin.storage
    .from("vehicle-inspections")
    .createSignedUrl(path, 3600);

  return NextResponse.json({ ok: true, file: data, signed_url: signed?.signedUrl ?? null });
}
