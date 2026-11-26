import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rentalAuth } from "@/lib/vehicles/rental-api";
import { decideEarlyReturn } from "@/lib/vehicles/rental-return";

// POST /api/vehicles/bookings/[id]/early-return/decision { approve: boolean } — the Vehicle
// Coordinator approves (the due-back day moves) or will call them. Vehicle managers only.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await rentalAuth(id);
  if (!auth.ok) return auth.response;
  if (!auth.isManager) return NextResponse.json({ error: "Only the Vehicle Coordinator can decide this." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { approve?: unknown };
  if (typeof body.approve !== "boolean") return NextResponse.json({ error: "approve must be true or false" }, { status: 400 });
  const r = await decideEarlyReturn(createAdminClient(), id, auth.userId, body.approve);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json({ success: true });
}
