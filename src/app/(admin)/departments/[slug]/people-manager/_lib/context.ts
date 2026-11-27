import "server-only";

import { notFound } from "next/navigation";
import { loadDepartmentHomeForViewer } from "@/lib/departments";
import { tabHref, tabLabel, visibleTabs } from "@/lib/departments/data";
import { redirectToCanonicalDepartment, sessionClient, settleViewerResult } from "@/lib/departments/load";
import { requireSignedIn } from "@/lib/departments/session";
import type { DepartmentTabLink } from "@/components/departments/people-manager/header";
import { peopleManagerAccess } from "./access";

export type PmContext = {
  slug: string;
  departmentName: string;
  userId: string;
  tabs: DepartmentTabLink[];
  /** A member of this department: can ask for leave (API: me.can_request). */
  canRequest: boolean;
  /** A leader of this department or an admin: sees the queue (API: me.can_see_department). */
  canManage: boolean;
};

/**
 * Who may open the People Manager: active members of the department, and
 * admins. Everyone else gets a 404. The API (and 421's RLS) decides again
 * on every read and write; this only picks the page and the nav.
 */
export async function loadPmContext(slug: string, path: string): Promise<PmContext> {
  const user = await requireSignedIn(path);
  const supabase = await sessionClient();
  const homeResult = await loadDepartmentHomeForViewer(supabase, slug);
  redirectToCanonicalDepartment(homeResult, path);
  const home = settleViewerResult(homeResult, path);
  const access = await peopleManagerAccess(supabase, home);
  if (!access.canUse) notFound();
  const tabs = visibleTabs(home).map((key) => ({ key, label: tabLabel(key), href: tabHref(home.department.slug, key) }));
  return {
    slug: home.department.slug,
    departmentName: home.department.name,
    userId: user.id,
    tabs,
    canRequest: access.canRequest,
    canManage: access.canManage,
  };
}

export function pmPagePath(slug: string, rest = ""): string {
  return `/departments/${encodeURIComponent(slug)}/people-manager${rest}`;
}

export function firstParam(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}
