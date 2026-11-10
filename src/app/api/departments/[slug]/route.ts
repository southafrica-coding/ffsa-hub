import { loadDepartmentHomeForViewer, viewerResponse } from "@/lib/departments/viewer";
import { createClient } from "@/lib/supabase/server";

// GET /api/departments/[slug]
// Detail viewers get the full home. Finance-only viewers get the header
// and the budget; the other sections are null and are not read.
// No detail and no budget access is 404.
// donors_dev is served as the finances_legal home (200), the same body a
// direct request for that slug returns. Pages use the redirect outcome.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const supabase = await createClient();
  const slug = (await params).slug;
  const first = await loadDepartmentHomeForViewer(supabase, slug);
  const result = first.kind === "redirect" ? await loadDepartmentHomeForViewer(supabase, first.slug) : first;
  return viewerResponse(result);
}
