import { NextResponse } from "next/server";
import { bad, fleetAuth, isUuid, readJson } from "@/lib/fleet/api";
import { deleteFleetProvider, upsertFleetProvider } from "@/services/fleet";
import { providerRow } from "@/lib/fleet/providers";

// PUT /api/vehicles/fleet/providers/[id] — change a workshop's details.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return bad("Unknown workshop");
  const body = await readJson(request);
  if (!body) return bad("Expected JSON");
  const row = providerRow(body);
  if (!row.name) return bad("Enter the workshop's name.");
  const { data, error } = await upsertFleetProvider(auth.supabase, { id, ...row });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, provider: data });
}

// DELETE /api/vehicles/fleet/providers/[id] — "Delete this provider? Past workshop visits
// keep the name."
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return bad("Unknown workshop");
  const { error } = await deleteFleetProvider(auth.supabase, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
