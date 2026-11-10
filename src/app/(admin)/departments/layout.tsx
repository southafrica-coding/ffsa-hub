import { notFound } from "next/navigation";
import { loadDepartmentsIndexForViewer } from "@/lib/departments";
import { DepartmentLoadError, sessionClient } from "@/lib/departments/load";

export const dynamic = "force-dynamic";

/**
 * An empty department list 404s before the index or a slug page renders.
 * A signed-out viewer is left for the page, which knows the full return path.
 */
export default async function DepartmentsLayout({ children }: { children: React.ReactNode }) {
  const result = await loadDepartmentsIndexForViewer(await sessionClient());
  if (result.kind === "forbidden" || result.kind === "not_found") notFound();
  if (result.kind === "error") throw new DepartmentLoadError();
  if (result.kind === "ok" && result.data.length === 0) notFound();
  return children;
}
