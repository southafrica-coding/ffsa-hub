import type { Metadata } from "next";
import { loadDepartmentHomeForViewer, loadServicesForViewer } from "@/lib/departments";
import { isDepartmentTab, tabHref, tabLabel, visibleTabs } from "@/lib/departments/data";
import { redirectToCanonicalDepartment, sessionClient, settleViewerResult } from "@/lib/departments/load";
import { requireSignedIn } from "@/lib/departments/session";
import { DepartmentView } from "./department-view";
import { departmentHasL10Teams } from "./l10/has-l10-teams";

export const metadata: Metadata = { title: "Department" };
export const dynamic = "force-dynamic";

function returnPath(pathname: string, search: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string") params.append(key, value);
    else if (Array.isArray(value)) for (const item of value) params.append(key, item);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export default async function DepartmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const search = await searchParams;
  const requested = typeof search.tab === "string" ? search.tab : undefined;
  const path = returnPath(`/departments/${slug}`, search);
  await requireSignedIn(path);
  const supabase = await sessionClient();
  const [homeResult, servicesResult] = await Promise.all([
    loadDepartmentHomeForViewer(supabase, slug),
    loadServicesForViewer(supabase),
  ]);
  redirectToCanonicalDepartment(homeResult, path);
  const model = settleViewerResult(homeResult, path);
  const services = settleViewerResult(servicesResult, path);

  const keys = visibleTabs(model);
  const tab = isDepartmentTab(requested) && keys.includes(requested) ? requested : (keys[0] ?? "overview");
  const tabs = keys.map((key) => ({ key, label: tabLabel(key), href: tabHref(model.department.slug, key) }));
  const hasL10Teams = tab === "overview" ? await departmentHasL10Teams(supabase, model.department.slug) : false;

  return <DepartmentView model={model} tab={tab} tabs={tabs} services={services} hasL10Teams={hasL10Teams} />;
}
