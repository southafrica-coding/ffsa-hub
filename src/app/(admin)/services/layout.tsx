import { loadCachedServicesForViewer, settleViewerResult } from "@/lib/departments/load";
import { requireSignedIn } from "@/lib/departments/session";
import { getRequestViewer } from "@/lib/viewer-cache";

/**
 * The 404 decision runs here, outside services/loading.tsx. A forbidden or
 * missing catalogue is a real HTTP 404. The page still renders the catalogue.
 */
export default async function ServicesLayout({ children }: { children: React.ReactNode }) {
  const path = "/services";
  await requireSignedIn(path);
  const viewer = await getRequestViewer();
  const servicesResult = await loadCachedServicesForViewer(viewer.supabase);
  settleViewerResult(servicesResult, path);
  return children;
}
