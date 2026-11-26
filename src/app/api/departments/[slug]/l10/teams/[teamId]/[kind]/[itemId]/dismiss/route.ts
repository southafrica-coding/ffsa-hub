import { dismissTeamHeadline } from "../../../../../_lib/handlers";

// POST /api/departments/[slug]/l10/teams/[teamId]/headlines/[itemId]/dismiss
// POST hides a headline (auto or not) by setting dismissed_at; DELETE shows
// it again. Other kinds are 404.

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string; teamId: string; kind: string; itemId: string }> }
) {
  const { slug, teamId, kind, itemId } = await params;
  return dismissTeamHeadline(slug, teamId, kind, itemId);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string; teamId: string; kind: string; itemId: string }> }
) {
  const { slug, teamId, kind, itemId } = await params;
  return dismissTeamHeadline(slug, teamId, kind, itemId, true);
}
