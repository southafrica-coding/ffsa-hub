import { loadHomeForViewer, viewerResponse } from "@/lib/departments/viewer";
import { createClient } from "@/lib/supabase/server";

// GET /api/me/home. okrCheckInsDue is empty: there is no due-check-in table.

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  return viewerResponse(await loadHomeForViewer(supabase));
}
