import { advanceTeamMeeting } from "../../../../../_lib/handlers";

// POST /api/departments/[slug]/l10/teams/[teamId]/meetings/[meetingId]/advance
// Moves to the next segment. Send { from: "<current segment>" } so a double click moves one step.

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; teamId: string; meetingId: string }> }
) {
  const { slug, teamId, meetingId } = await params;
  return advanceTeamMeeting(request, slug, teamId, meetingId);
}
