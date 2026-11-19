import { NextResponse } from "next/server";
import { bad, fleetAuth, isUuid } from "@/lib/fleet/api";
import { deleteFleetDraft, getFleetDraft, saveFleetDraft } from "@/services/fleet";

// The signed-in person's inspection draft for one vehicle. The page also keeps it in
// localStorage (it must survive no signal in the yard); this copy lets a draft be
// finished on another device.

export async function GET(_request: Request, { params }: { params: Promise<{ vehicleId: string }> }) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;
  const { vehicleId } = await params;
  if (!isUuid(vehicleId)) return bad("Unknown vehicle");
  const { data, error } = await getFleetDraft(auth.supabase, auth.user.id, vehicleId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ draft: data?.data ?? null, updatedAt: data?.updated_at ?? null });
}

export async function PUT(request: Request, { params }: { params: Promise<{ vehicleId: string }> }) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;
  const { vehicleId } = await params;
  if (!isUuid(vehicleId)) return bad("Unknown vehicle");
  const text = await request.text();
  if (text.length > 500_000) return bad("The draft is too large", 413);
  let draft: unknown;
  try {
    draft = JSON.parse(text);
  } catch {
    return bad("Expected JSON");
  }
  if (!draft || typeof draft !== "object") return bad("Expected a draft");
  const { error } = await saveFleetDraft(auth.supabase, auth.user.id, vehicleId, draft);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ vehicleId: string }> }) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;
  const { vehicleId } = await params;
  if (!isUuid(vehicleId)) return bad("Unknown vehicle");
  const { error } = await deleteFleetDraft(auth.supabase, auth.user.id, vehicleId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
