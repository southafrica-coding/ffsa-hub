import { loadServicesForViewer } from "@/lib/departments";
import { sessionClient, settleViewerResult } from "@/lib/departments/load";
import { requireSignedIn } from "@/lib/departments/session";

/**
 * The 404 decision runs here, outside services/loading.tsx. A forbidden or
 * missing catalogue is a real HTTP 404. The page still renders the catalogue.
 */
export default async function ServicesLayout({ children }: { children: React.ReactNode }) {
  const path = "/services";
  await requireSignedIn(path);
  const supabase = await sessionClient();
  const servicesResult = await loadServicesForViewer(supabase);
  settleViewerResult(servicesResult, path);
  return children;
}
