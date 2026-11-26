import { getMeeting } from "../../../../_lib/handlers";

// GET /api/departments/[slug]/l10/teams/[teamId]/meetings/[meetingId] — the meeting and its attendees.

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; teamId: string; meetingId: string }> }
) {
  const { slug, teamId, meetingId } = await params;
  return getMeeting(slug, teamId, meetingId);
}
