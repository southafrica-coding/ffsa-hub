import { NextResponse } from "next/server";
import { saveVisit } from "@/lib/fleet/save-visit";
import { fleetAuth, readJson } from "@/lib/fleet/api";

// POST /api/vehicles/fleet/visits — book or log a workshop visit (SPEC 6.7).
export async function POST(request: Request) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;
  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  return saveVisit(auth, null, body);
}
