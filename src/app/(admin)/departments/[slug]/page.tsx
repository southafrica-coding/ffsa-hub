import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  departmentNames,
  isDepartmentTab,
  tabHref,
  tabLabel,
  visibleTabs,
} from "@/lib/departments/data";
import { loadDepartmentApi } from "@/lib/departments/load";
import { requireSignedIn } from "@/lib/departments/session";
import type { DepartmentHome, DepartmentSummary, HubService } from "@/lib/departments/ui-contract";
import { DepartmentView } from "./department-view";

export const metadata: Metadata = { title: "Department" };

export default async function DepartmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireSignedIn();
  const { slug } = await params;
  const { tab: requested } = await searchParams;
  const [model, services, departments] = await Promise.all([
    loadDepartmentApi<DepartmentHome>(`/api/departments/${encodeURIComponent(slug)}`),
    loadDepartmentApi<HubService[]>("/api/services"),
    loadDepartmentApi<DepartmentSummary[]>("/api/departments"),
  ]);
  if (model.department.slug !== slug) {
    const query = requested ? `?tab=${encodeURIComponent(requested)}` : "";
    redirect(`/departments/${model.department.slug}${query}`);
  }

  const keys = visibleTabs(model);
  const tab = isDepartmentTab(requested) && keys.includes(requested) ? requested : (keys[0] ?? "overview");
  const tabs = keys.map((key) => ({ key, label: tabLabel(key), href: tabHref(model.department.slug, key) }));
  const names = departmentNames(departments);

  return (
    <DepartmentView
      model={model}
      tab={tab}
      tabs={tabs}
      services={services}
      parentName={model.department.parentSlug ? (names.get(model.department.parentSlug) ?? null) : null}
    />
  );
}
