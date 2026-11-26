import "server-only";

import { redirect } from "next/navigation";
import { loadCachedDepartmentsIndex, sessionClient } from "@/lib/departments/load";
import { loginPath } from "@/lib/departments/login-path";
import { getViewer, requireSignedIn } from "@/lib/departments/session";
import { SONGWRITING_DEPARTMENT_SLUG } from "@/components/departments/songwriting/header";
import { callerCanAccessSongwriting } from "../../departments/[slug]/songwriting/_lib/context";

export type LibraryViewer = {
  /** A member of the owning department (or an admin): moves stage and placement, sees the lead board. */
  canManage: boolean;
  /** The owning department's display name, when the viewer can see it. */
  ownerName: string | null;
};

/**
 * Managers are the owning department's members and admins, the same rule as
 * 417's pw_can_access_songwriting; the database enforces it again on every
 * write. If the RPC isn't there yet, the viewer's own membership decides.
 */
async function resolveViewer(): Promise<LibraryViewer> {
  const supabase = await sessionClient();
  const [index, rpc] = await Promise.all([loadCachedDepartmentsIndex(supabase), callerCanAccessSongwriting(supabase)]);
  const owner = index.kind === "ok" ? index.data.find((d) => d.slug === SONGWRITING_DEPARTMENT_SLUG) : undefined;
  const canManage = rpc.error ? (owner?.viewerMembership ?? "none") !== "none" : rpc.data === true;
  return { canManage, ownerName: owner?.name ?? null };
}

/** The Song Library is open to every signed-in, active user. Inactive accounts 404. */
export async function loadLibraryViewer(path: string): Promise<LibraryViewer> {
  await requireSignedIn(path);
  return resolveViewer();
}

/** For the library home, which sits under a loading boundary and must not 404. */
export async function loadLibraryViewerForIndex(path: string): Promise<LibraryViewer | null> {
  const viewer = await getViewer();
  if (!viewer.user) redirect(loginPath(path));
  if (!viewer.active) return null;
  return resolveViewer();
}
