import { deleteTeamItem, updateTeamItem } from "../../../../_lib/handlers";

// /api/departments/[slug]/l10/teams/[teamId]/[kind]/[itemId] — edit or delete one item.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; teamId: string; kind: string; itemId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { slug, teamId, kind, itemId } = await params;
  return updateTeamItem(request, slug, teamId, kind, itemId);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { slug, teamId, kind, itemId } = await params;
  return deleteTeamItem(slug, teamId, kind, itemId);
}
