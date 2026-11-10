import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  foldTarget,
  getDepartmentPage,
  getDepartmentViewer,
  isDepartmentTab,
  resolveDepartment,
  tabHref,
  tabLabel,
  viewerCanOpenModule,
  visibleTabs,
} from "@/lib/departments/data";
import { ministryTools } from "@/lib/departments/mocks";
import { requireSignedIn } from "@/lib/departments/session";
import { DepartmentView } from "./department-view";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const department = resolveDepartment(slug);
  return { title: department?.name ?? "Department" };
}

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
  const folded = foldTarget(slug);
  if (folded) {
    const query = requested ? `?tab=${encodeURIComponent(requested)}` : "";
    redirect(`/departments/${folded}${query}`);
  }
  const viewer = getDepartmentViewer();
  const model = getDepartmentPage(slug, viewer);
  if (!model) notFound();

  const keys = visibleTabs(model);
  const tab =
    isDepartmentTab(requested) && keys.includes(requested) ? requested : (keys[0] ?? "overview");
  const tabs = keys.map((key) => ({ key, label: tabLabel(key), href: tabHref(model.department.slug, key) }));
  const tools = model.access.canSeeDepartmentDetail
    ? ministryTools(model.department.slug).filter((item) => viewerCanOpenModule(item.moduleId, viewer))
    : [];

  return <DepartmentView model={model} tab={tab} tabs={tabs} tools={tools} />;
}
