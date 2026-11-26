import { NextResponse } from "next/server";
import { bad, fleetAuth, readJson } from "@/lib/fleet/api";
import { upsertFleetProvider } from "@/services/fleet";
import { providerRow } from "@/lib/fleet/providers";

// POST /api/vehicles/fleet/providers — add a workshop.
export async function POST(request: Request) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;
  const body = await readJson(request);
  if (!body) return bad("Expected JSON");
  const row = providerRow(body);
  if (!row.name) return bad("Enter the workshop's name.");
  const { data, error } = await upsertFleetProvider(auth.supabase, { ...row, created_by: auth.user.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, provider: data });
}
