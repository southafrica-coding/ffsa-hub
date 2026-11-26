import { endTeamMeeting } from "../../../../../_lib/handlers";

// POST /api/departments/[slug]/l10/teams/[teamId]/meetings/[meetingId]/end
// Body { ratings: [{ user_id, rating 1–10 }] }. Ends the meeting, then DMs each
// attendee their open to-dos once (lib/slack/l10-followup). Safe to repeat.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; teamId: string; meetingId: string }> }
) {
  const { slug, teamId, meetingId } = await params;
  return endTeamMeeting(request, slug, teamId, meetingId);
}
