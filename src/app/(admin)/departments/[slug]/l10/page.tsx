import type { Metadata } from "next";
import { TeamPicker } from "@/components/departments/l10/team-picker";
import { loadL10Department } from "./load-department";

export const metadata: Metadata = { title: "L10" };
export const dynamic = "force-dynamic";

export default async function L10TeamsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { department } = await loadL10Department(slug, `/departments/${slug}/l10`);
  return <TeamPicker slug={department.slug} departmentName={department.name} />;
}
