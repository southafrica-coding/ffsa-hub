import { notFound } from "next/navigation";
import { loadCachedHomeForViewer, loadCachedServicesForViewer, settleViewerResult } from "@/lib/departments/load";
import { requireSignedIn } from "@/lib/departments/session";
import { getRequestViewer } from "@/lib/viewer-cache";

/**
 * The 404 decision runs here, outside home/loading.tsx. The page still renders
 * the same branches; this only repeats the guard so a missing or inactive
 * viewer is a real HTTP 404 instead of a streamed 200.
 */
export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const path = "/home";
  await requireSignedIn(path);
  const viewer = await getRequestViewer();
  const homeResult = await loadCachedHomeForViewer(viewer.supabase);
  if (homeResult.kind === "ok") return children;
  if (homeResult.kind === "unauthenticated") settleViewerResult(homeResult, path);
  if (homeResult.kind === "not_found") notFound();
  settleViewerResult(await loadCachedServicesForViewer(viewer.supabase), path);
  return children;
}
