import "server-only";
import { notFound, redirect } from "next/navigation";
import { loadDepartmentHomeForViewer } from "@/lib/departments";
import { sessionClient, settleViewerResult } from "@/lib/departments/load";
import { requireSignedIn } from "@/lib/departments/session";
import { isUuid } from "@/lib/departments/validate";
import { L10_TABLES } from "@/lib/l10/types";
import { asL10ReadClient } from "./l10-read-client";

/**
 * Signed in, active, and allowed to see the department; then its name.
 * An old slug redirects to the same L10 path under the current one.
 */
export async function loadL10Department(slug: string, path: string) {
  const user = await requireSignedIn(path);
  const supabase = await sessionClient();
  const result = await loadDepartmentHomeForViewer(supabase, slug);
  if (result.kind === "redirect") {
    redirect(`/departments/${encodeURIComponent(result.slug)}${path.slice(`/departments/${slug}`.length)}`);
  }
  const home = settleViewerResult(result, path);
  return { viewerId: user.id, department: home.department, supabase };
}

/**
 * loadL10Department, then fail closed: a teamId that isn't a uuid, or a team
 * RLS hides from this viewer (not on it, not overseeing it), inactive or in
 * another department, is a 404 rather than a client shell.
 */
export async function loadL10Team(slug: string, teamId: string, path: string) {
  if (!isUuid(teamId)) notFound();
  const loaded = await loadL10Department(slug, path);
  const db = asL10ReadClient(loaded.supabase);
  if (!db) notFound();
  const [team, ministry] = await Promise.all([
    db
      .from<{ id: string; department_id: string; is_active: boolean }>(L10_TABLES.teams)
      .select("id, department_id, is_active")
      .eq("id", teamId)
      .maybeSingle(),
    db.from<{ id: string }>("staff_ministries").select("id").eq("slug", loaded.department.slug).maybeSingle(),
  ]);
  if (
    team.error ||
    ministry.error ||
    !team.data ||
    team.data.is_active === false ||
    !ministry.data?.id ||
    team.data.department_id !== ministry.data.id
  ) {
    notFound();
  }
  return loaded;
}
