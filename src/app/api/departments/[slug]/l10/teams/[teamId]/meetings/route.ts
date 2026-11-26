import { listMeetings, startTeamMeeting } from "../../../_lib/handlers";

// /api/departments/[slug]/l10/teams/[teamId]/meetings
// GET the last 20 meetings. POST starts one ({ attendee_user_ids? }, default every member).

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; teamId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { slug, teamId } = await params;
  return listMeetings(slug, teamId);
}

export async function POST(request: Request, { params }: Params) {
  const { slug, teamId } = await params;
  return startTeamMeeting(request, slug, teamId);
}
