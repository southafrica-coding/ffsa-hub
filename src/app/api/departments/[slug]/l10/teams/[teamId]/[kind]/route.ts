import { createTeamItem, listTeamItems } from "../../../_lib/handlers";

// /api/departments/[slug]/l10/teams/[teamId]/[kind]
// kind: rocks | measurables | todos | issues | headlines. Anything else is 404.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; teamId: string; kind: string }> };

export async function GET(request: Request, { params }: Params) {
  const { slug, teamId, kind } = await params;
  return listTeamItems(request, slug, teamId, kind);
}

export async function POST(request: Request, { params }: Params) {
  const { slug, teamId, kind } = await params;
  return createTeamItem(request, slug, teamId, kind);
}
