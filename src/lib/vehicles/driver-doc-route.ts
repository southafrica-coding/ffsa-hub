// Shared handlers for a booking driver's uploaded documents — the licence
// (/api/vehicles/drivers/[id]/license) and the passport page photo
// (/api/vehicles/drivers/[id]/passport). Both live in the private
// vehicle-inspections bucket and are read back only through signed URLs.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getVehicleAccess,
  getDriverWithBooking,
  setDriverLicense,
} from "@/services/vehicles";

const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/heic", "application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — matches the bucket limit.
const BUCKET = "vehicle-inspections";
const SIGNED_TTL = 3600;

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

type DriverBooking = { id: string; status: string; requested_by: string | null };

/** The two documents a booking's driver row can carry (licence, migration 196; passport, 242). */
export type DriverDocKind = "license" | "passport";

const DOC = {
  license: { label: "licence", folder: "licenses", column: "license_file_url" },
  passport: { label: "passport photo", folder: "passports", column: "passport_file_url" },
} as const;

/**
 * Resolve the driver and decide whether the caller may touch its document.
 * Managers always may; the booking's requester may until the booking is
 * completed or cancelled.
 */
async function authorize(driverId: string, kind: DriverDocKind) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }

  const { data: driver } = await getDriverWithBooking(supabase, driverId);
  if (!driver) {
    return { error: NextResponse.json({ error: "Driver not found" }, { status: 404 }) };
  }
  const booking = (
    Array.isArray(driver.booking) ? driver.booking[0] : driver.booking
  ) as DriverBooking | null;
  if (!booking) {
    return { error: NextResponse.json({ error: "Booking not found" }, { status: 404 }) };
  }

  const access = await getVehicleAccess(supabase, user.id);
  const isManager = access.isAdmin || access.canApprove || access.canManage;
  const isOwner = booking.requested_by === user.id;
  if (!isManager && !isOwner) {
    return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }
  const locked = booking.status === "completed" || booking.status === "cancelled";

  return {
    error: null,
    supabase,
    user,
    driver,
    booking,
    isManager,
    locked,
    currentPath: (driver as Record<string, unknown>)[DOC[kind].column] as string | null,
  };
}


/** GET / POST / DELETE route handlers for one document kind. */
export function driverDocRoute(kind: DriverDocKind) {
  // GET — mint a fresh signed URL for the document.
  async function GET(
    _request: Request,
    { params }: { params: Promise<{ driverId: string }> }
  ) {
    const { driverId } = await params;
    const ctx = await authorize(driverId, kind);
    if (ctx.error) return ctx.error;
    if (!ctx.currentPath) {
      return NextResponse.json({ ok: true, signed_url: null });
    }
    const { data: signed } = await createAdminClient()
      .storage.from(BUCKET)
      .createSignedUrl(ctx.currentPath, SIGNED_TTL);
    return NextResponse.json({ ok: true, signed_url: signed?.signedUrl ?? null });
  }

  // POST — multipart upload (or replace) of the document.
  async function POST(
    request: Request,
    { params }: { params: Promise<{ driverId: string }> }
  ) {
    const { driverId } = await params;
    const ctx = await authorize(driverId, kind);
    if (ctx.error) return ctx.error;
    if (ctx.locked && !ctx.isManager) {
      return NextResponse.json(
        { error: "This booking is closed — ask a vehicle manager to update the drivers." },
        { status: 403 }
      );
    }

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
        { error: `The ${DOC[kind].label} must be an image (PNG/JPG/WEBP/HEIC) or a PDF` },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File must be 10 MB or smaller" }, { status: 400 });
    }

    const admin = createAdminClient();
    const ext = EXT[file.type] ?? "bin";
    const path = `${DOC[kind].folder}/${ctx.booking.id}/${driverId}/${Date.now()}-${Math.round(
      Math.random() * 1e6
    )}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const upload = await admin.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: file.type, upsert: false });
    if (upload.error) {
      return NextResponse.json({ error: upload.error.message }, { status: 500 });
    }

    const now = new Date().toISOString();
    const { error } = await setDriverLicense(
      ctx.supabase,
      driverId,
      kind === "license"
        ? { license_file_url: path, license_file_name: file.name, license_uploaded_at: now, license_uploaded_by: ctx.user.id }
        : { passport_file_url: path, passport_file_name: file.name, passport_uploaded_at: now }
    );
    if (error) {
      // Roll back the orphaned object if the metadata write fails.
      await admin.storage.from(BUCKET).remove([path]);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Drop the superseded file now that the row points at the new one.
    if (ctx.currentPath) await admin.storage.from(BUCKET).remove([ctx.currentPath]);

    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
    return NextResponse.json({
      ok: true,
      file_path: path,
      file_name: file.name,
      signed_url: signed?.signedUrl ?? null,
    });
  }

  // DELETE — remove the document.
  async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ driverId: string }> }
  ) {
    const { driverId } = await params;
    const ctx = await authorize(driverId, kind);
    if (ctx.error) return ctx.error;
    if (ctx.locked && !ctx.isManager) {
      return NextResponse.json(
        { error: "This booking is closed — ask a vehicle manager to update the drivers." },
        { status: 403 }
      );
    }
    if (!ctx.currentPath) return NextResponse.json({ ok: true });

    const { error } = await setDriverLicense(
      ctx.supabase,
      driverId,
      kind === "license"
        ? { license_file_url: null, license_file_name: null, license_uploaded_at: null, license_uploaded_by: null }
        : { passport_file_url: null, passport_file_name: null, passport_uploaded_at: null }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await createAdminClient().storage.from(BUCKET).remove([ctx.currentPath]);
    return NextResponse.json({ ok: true });
  }

  return { GET, POST, DELETE };
}
