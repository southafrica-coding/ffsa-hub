import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rentalAuth } from "@/lib/vehicles/rental-api";
import { releaseHold } from "@/lib/vehicles/rental-return";

// POST /api/vehicles/bookings/[id]/hold { note } — release the hold after an International
// Team booking (Gideon, 24 Nov 2026: the coordinator may, for any reason, with a note).
// Vehicle managers only; the database refuses anyone else too (migration 365).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await rentalAuth(id);
  if (!auth.ok) return auth.response;
  if (!auth.isManager) return NextResponse.json({ error: "Only the Vehicle Coordinator can release a hold." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const r = await releaseHold(createAdminClient(), id, auth.userId, (body as { note?: unknown }).note);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ success: true, message: "Hold released. The vehicles are free again after the due-back day." });
}
