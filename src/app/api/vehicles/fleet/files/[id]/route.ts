import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bad, fleetAuth } from "@/lib/fleet/api";
import { getFleetFile } from "@/services/fleet";

// GET /api/vehicles/fleet/files/[id] — a Fleet photo or PDF. Checks access (RLS on
// fleet_files), then redirects to a signed URL valid for an hour. Pages use this path
// wherever the Fleet app used /_blob/<id>.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await fleetAuth("view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!/^[0-9a-f]{32}$/.test(id)) return bad("Not found", 404);

  const { data: file } = await getFleetFile(auth.supabase, id);
  if (!file) return bad("Not found", 404);
  const { data, error } = await createAdminClient().storage.from("fleet-files").createSignedUrl(file.path, 3600);
  if (error || !data?.signedUrl) return NextResponse.json({ error: error?.message || "Not found" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "Cache-Control": "private, max-age=3000" } });
}
