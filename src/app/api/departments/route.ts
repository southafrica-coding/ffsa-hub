import { loadDepartmentsIndexForViewer, viewerResponse } from "@/lib/departments/viewer";
import { createClient } from "@/lib/supabase/server";

// GET /api/departments — homes the caller can open, including budget-only.
// Inactive accounts and failed access lookups are 403. A home the caller
// cannot open is omitted, not 404'd from this list.

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  return viewerResponse(await loadDepartmentsIndexForViewer(supabase));
}
