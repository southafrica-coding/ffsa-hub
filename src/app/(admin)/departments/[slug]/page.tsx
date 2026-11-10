import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  getDepartmentPage,
  getDepartmentViewer,
  isDepartmentTab,
  resolveDepartment,
} from "@/lib/departments/data";
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
  const viewer = getDepartmentViewer();
  const model = getDepartmentPage(slug, viewer);
  if (!model) notFound();

  if (slug !== model.department.slug) {
    const query = requested ? `?tab=${encodeURIComponent(requested)}` : "";
    redirect(`/departments/${model.department.slug}${query}`);
  }

  const tab = isDepartmentTab(requested) && model.tabs.some((item) => item.key === requested)
    ? requested
    : "overview";

  return <DepartmentView model={model} tab={tab} />;
}
