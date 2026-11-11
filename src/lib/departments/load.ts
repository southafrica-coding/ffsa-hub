import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import {
  loadDepartmentsIndexForViewer,
  type DepartmentHome,
  type DepartmentHomeResult,
  type ViewerResult,
} from "@/lib/departments";
import { loginPath } from "@/lib/departments/login-path";
import { getViewer } from "@/lib/departments/session";

/** One index read per request, shared by the shell layouts and the departments pages. */
export const loadCachedDepartmentsIndex = cache(loadDepartmentsIndexForViewer);

export type ShellDepartment = { id: string; label: string; href: string };

/** HubShell's prop. An empty list hides the department group and the phone tab. */
export function toShellDepartments(rows: readonly { slug: string; name: string }[]): ShellDepartment[] {
  return rows.map((row) => ({
    id: row.slug,
    label: row.name,
    href: `/departments/${row.slug}`,
  }));
}

/** Failed, forbidden, or signed-out reads become an empty shell list. They do not throw. */
export async function departmentsForShell(client: Parameters<typeof loadCachedDepartmentsIndex>[0]): Promise<ShellDepartment[]> {
  try {
    const result = await loadCachedDepartmentsIndex(client);
    if (result.kind !== "ok") return [];
    return toShellDepartments(result.data);
  } catch {
    return [];
  }
}

export class DepartmentLoadError extends Error {
  constructor(message = "Department data failed") {
    super(message);
    this.name = "DepartmentLoadError";
  }
}

export async function sessionClient() {
  const viewer = await getViewer();
  return viewer.supabase;
}

/** Map a viewer-wrapper result. Redirect is handled by the department page. */
export function settleViewerResult<T>(result: ViewerResult<T>, currentPath: string): T {
  switch (result.kind) {
    case "ok":
      return result.data;
    case "unauthenticated":
      redirect(loginPath(currentPath));
    case "forbidden":
    case "not_found":
      notFound();
    case "error":
      throw new DepartmentLoadError(
        result.error instanceof Error ? result.error.message : "Department data failed"
      );
  }
}

export function redirectToCanonicalDepartment(
  result: DepartmentHomeResult,
  currentPath: string
): asserts result is ViewerResult<DepartmentHome> {
  if (result.kind !== "redirect") return;
  const query = currentPath.includes("?") ? currentPath.slice(currentPath.indexOf("?")) : "";
  redirect(`/departments/${result.slug}${query}`);
}
