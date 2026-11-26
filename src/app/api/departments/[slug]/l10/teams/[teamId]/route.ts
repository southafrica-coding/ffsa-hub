import { getTeam } from "../../_lib/handlers";

// GET /api/departments/[slug]/l10/teams/[teamId] — members, this quarter's rocks,
// the scorecard, open to-dos and issues, the running meeting and the last five.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; teamId: string }> }) {
  const { slug, teamId } = await params;
  return getTeam(slug, teamId);
}
