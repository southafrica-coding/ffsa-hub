import "server-only";
import { notFound, redirect } from "next/navigation";
import type { DepartmentHome, DepartmentHomeResult, ViewerResult } from "@/lib/departments";
import { loginPath } from "@/lib/departments/login-path";
import { getViewer } from "@/lib/departments/session";

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
