import type { Metadata } from "next";
import { TeamView } from "@/components/departments/l10/team-view";
import { loadL10Department } from "../load-department";

export const metadata: Metadata = { title: "L10 team" };
export const dynamic = "force-dynamic";

// Slack follow-up buttons link here.
export default async function L10TeamPage({ params }: { params: Promise<{ slug: string; teamId: string }> }) {
  const { slug, teamId } = await params;
  const { department } = await loadL10Department(slug, `/departments/${slug}/l10/${teamId}`);
  return <TeamView slug={department.slug} departmentName={department.name} teamId={teamId} />;
}
