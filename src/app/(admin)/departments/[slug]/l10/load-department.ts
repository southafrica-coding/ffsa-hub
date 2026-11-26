import "server-only";
import { redirect } from "next/navigation";
import { loadDepartmentHomeForViewer } from "@/lib/departments";
import { sessionClient, settleViewerResult } from "@/lib/departments/load";
import { requireSignedIn } from "@/lib/departments/session";

/**
 * Signed in, active, and allowed to see the department; then its name.
 * An old slug redirects to the same L10 path under the current one.
 */
export async function loadL10Department(slug: string, path: string) {
  const user = await requireSignedIn(path);
  const supabase = await sessionClient();
  const result = await loadDepartmentHomeForViewer(supabase, slug);
  if (result.kind === "redirect") {
    redirect(`/departments/${encodeURIComponent(result.slug)}${path.slice(`/departments/${slug}`.length)}`);
  }
  const home = settleViewerResult(result, path);
  return { viewerId: user.id, department: home.department };
}
