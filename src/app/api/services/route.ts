import { loadServicesForViewer, viewerResponse } from "@/lib/departments/viewer";
import { createClient } from "@/lib/supabase/server";

// GET /api/services — bare HubService[].

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  return viewerResponse(await loadServicesForViewer(supabase));
}
