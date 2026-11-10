import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isDepartmentTab, tabHref, tabLabel, visibleTabs } from "@/lib/departments/data";
import { loadDepartmentHome, loadHubServices } from "@/lib/departments/load";
import { requireSignedIn } from "@/lib/departments/session";
import { DepartmentView } from "./department-view";

export const metadata: Metadata = { title: "Department" };

export default async function DepartmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const { tab: requested } = await searchParams;
  const path = `/departments/${slug}`;
  await requireSignedIn(path);
  const [model, services] = await Promise.all([loadDepartmentHome(slug, path), loadHubServices(path)]);
  if (model.department.slug !== slug) {
    const query = requested ? `?tab=${encodeURIComponent(requested)}` : "";
    redirect(`/departments/${model.department.slug}${query}`);
  }

  const keys = visibleTabs(model);
  const tab = isDepartmentTab(requested) && keys.includes(requested) ? requested : (keys[0] ?? "overview");
  const tabs = keys.map((key) => ({ key, label: tabLabel(key), href: tabHref(model.department.slug, key) }));

  return <DepartmentView model={model} tab={tab} tabs={tabs} services={services} />;
}
