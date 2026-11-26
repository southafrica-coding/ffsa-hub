import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rentalAuth } from "@/lib/vehicles/rental-api";
import { markReturned } from "@/lib/vehicles/rental-return";

// POST /api/vehicles/bookings/[id]/returned — the Vehicle Coordinator has the keys back
// (the same as Returned on the 07:00 Slack message). Vehicle managers only.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await rentalAuth(id);
  if (!auth.ok) return auth.response;
  if (!auth.isManager) return NextResponse.json({ error: "Only the Vehicle Coordinator can mark a vehicle returned." }, { status: 403 });
  const r = await markReturned(createAdminClient(), id, auth.userId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json({ success: true });
}
