import { deleteVersion, patchVersion } from "../../../../_lib/songs";

// /api/song-library/songs/[songId]/versions/[versionId]. Handlers and the full route list: app/api/song-library/_lib/songs.ts.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ songId: string; versionId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { songId, versionId } = await params;
  return patchVersion(request, songId, versionId);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { songId, versionId } = await params;
  return deleteVersion(songId, versionId);
}
