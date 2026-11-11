import { notFound, redirect } from "next/navigation";
import { loginPath } from "@/lib/departments/login-path";
import { getRequestViewer } from "@/lib/viewer-cache";

/**
 * One session read per request, shared with the admin and portal layouts.
 * The department wrappers still check the same user on their own client.
 */
export const getViewer = getRequestViewer;

/** Signed-in and active. A missing session goes to login. An inactive account is a 404. */
export async function requireSignedIn(currentPath = "") {
  const viewer = await getViewer();
  if (!viewer.user) redirect(loginPath(currentPath));
  if (!viewer.active) notFound();
  return viewer.user;
}
