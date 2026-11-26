import "server-only";

import { notFound } from "next/navigation";
import { loadDepartmentHomeForViewer } from "@/lib/departments";
import { redirectToCanonicalDepartment, sessionClient, settleViewerResult } from "@/lib/departments/load";
import { requireSignedIn } from "@/lib/departments/session";
import { SONGWRITING_DEPARTMENT_SLUG } from "@/components/departments/songwriting/header";

export type SongwritingContext = {
  slug: string;
  departmentName: string;
};

/**
 * Who may open Songwriting: active members of the owning department, and
 * admins (417's pw_can_access_songwriting). Everyone else, and any other
 * department's slug, gets a plain 404 so the area's existence isn't shown.
 *
 * The RPC is asked as the caller. If it isn't there yet (417 not applied),
 * the department membership the page already loaded decides; the data
 * itself stays behind 417's RLS either way.
 */
export async function loadSongwritingContext(slug: string, path: string): Promise<SongwritingContext> {
  await requireSignedIn(path);
  if (slug !== SONGWRITING_DEPARTMENT_SLUG) notFound();
  const supabase = await sessionClient();
  const homeResult = await loadDepartmentHomeForViewer(supabase, slug);
  redirectToCanonicalDepartment(homeResult, path);
  const home = settleViewerResult(homeResult, path);

  const { data, error } = await callerCanAccessSongwriting(supabase);
  const allowed = error ? home.department.viewerMembership !== "none" : data === true;
  if (!allowed) notFound();

  return { slug: home.department.slug, departmentName: home.department.name };
}

/** 417's helper isn't in the generated Database types until they are regenerated. */
type RpcClient = { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> };

export async function callerCanAccessSongwriting(client: unknown): Promise<{ data: unknown; error: unknown }> {
  return (client as RpcClient).rpc("pw_can_access_songwriting");
}

export function pathFor(slug: string, rest = ""): string {
  return `/departments/${encodeURIComponent(slug)}/songwriting${rest}`;
}
