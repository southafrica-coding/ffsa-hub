import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import {
  loadDepartmentsIndexForViewer,
  loadHomeForViewer,
  loadServicesForViewer,
  type DepartmentHome,
  type DepartmentHomeResult,
  type ViewerDepartmentMembership,
  type ViewerResult,
} from "@/lib/departments";
import { loginPath } from "@/lib/departments/login-path";
import { getViewer } from "@/lib/departments/session";

/** One index read per request, shared by the shell layouts and the departments pages. */
export const loadCachedDepartmentsIndex = cache(loadDepartmentsIndexForViewer);

/** One home read per request, shared by the home layout and the home page. */
export const loadCachedHomeForViewer = cache(loadHomeForViewer);

/** One services read per request, shared by the services layout and the services page. */
export const loadCachedServicesForViewer = cache(loadServicesForViewer);

export type ShellDepartment = { id: string; label: string; href: string };

const SHELL_MEMBERSHIPS = new Set<ViewerDepartmentMembership>(["member", "leader"]);

/** Member or leader. Admin and Leadership Team visibility is none. */
export function isMyDepartment(viewerMembership: ViewerDepartmentMembership): boolean {
  return SHELL_MEMBERSHIPS.has(viewerMembership);
}

export function myDepartments<T extends { viewerMembership: ViewerDepartmentMembership }>(rows: readonly T[]): T[] {
  return rows.filter((row) => isMyDepartment(row.viewerMembership));
}

/**
 * HubShell's prop. Only a member or a leader appears. Admin and Leadership
 * Team visibility stay on the index, not in this group. An empty list hides
 * the group and the phone tab.
 */
export function toShellDepartments(
  rows: readonly { slug: string; name: string; viewerMembership: ViewerDepartmentMembership }[]
): ShellDepartment[] {
  return myDepartments(rows).map((row) => ({
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
