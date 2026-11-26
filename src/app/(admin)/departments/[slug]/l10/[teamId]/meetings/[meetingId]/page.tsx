import type { Metadata } from "next";
import { MeetingMode } from "@/components/departments/l10/meeting-mode";
import { loadL10Department } from "../../../load-department";

export const metadata: Metadata = { title: "L10 meeting" };
export const dynamic = "force-dynamic";

// Segments, the end confirm and the sent screen are states of this page.
export default async function L10MeetingPage({
  params,
}: {
  params: Promise<{ slug: string; teamId: string; meetingId: string }>;
}) {
  const { slug, teamId, meetingId } = await params;
  const { department, viewerId } = await loadL10Department(
    slug,
    `/departments/${slug}/l10/${teamId}/meetings/${meetingId}`
  );
  return <MeetingMode slug={department.slug} teamId={teamId} meetingId={meetingId} viewerId={viewerId} />;
}
