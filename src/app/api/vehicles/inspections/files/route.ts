import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getInspectionFiles,
  deleteInspectionFile,
  type VehicleInspectionFile,
} from "@/services/vehicles";

// GET /api/vehicles/inspections/files?booking_id=… — files + signed URLs.
export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const bookingId = new URL(request.url).searchParams.get("booking_id");
  if (!bookingId) return NextResponse.json({ error: "booking_id is required" }, { status: 400 });

  const { data, error } = await getInspectionFiles(supabase, bookingId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const admin = createAdminClient();
  const files = await Promise.all(
    ((data ?? []) as VehicleInspectionFile[]).map(async (f) => {
      const { data: signed } = await admin.storage
        .from("vehicle-inspections")
        .createSignedUrl(f.file_path, 3600);
      return { ...f, signed_url: signed?.signedUrl ?? null };
    })
  );

  return NextResponse.json({ files });
}

// DELETE /api/vehicles/inspections/files?id=…&file_path=…
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const filePath = url.searchParams.get("file_path");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  if (filePath) {
    const admin = createAdminClient();
    await admin.storage.from("vehicle-inspections").remove([filePath]);
  }

  const { error } = await deleteInspectionFile(supabase, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
