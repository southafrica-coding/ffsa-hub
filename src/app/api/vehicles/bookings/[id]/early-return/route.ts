import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rentalAuth, sastToday } from "@/lib/vehicles/rental-api";
import { requestEarlyReturn } from "@/lib/vehicles/rental-return";

// POST /api/vehicles/bookings/[id]/early-return { date } — someone on the booking asks to
// bring it back earlier; the Vehicle Coordinator gets a Slack message to approve.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await rentalAuth(id);
  if (!auth.ok) return auth.response;
  if (!auth.isMember && !auth.isManager) return NextResponse.json({ error: "Only the people on this booking can ask to return it early." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { date?: unknown };
  const r = await requestEarlyReturn(createAdminClient(), id, auth.userId, typeof body.date === "string" ? body.date : "", sastToday());
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ success: true, message: r.message });
}
