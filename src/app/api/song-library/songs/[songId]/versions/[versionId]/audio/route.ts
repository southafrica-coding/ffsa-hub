import { versionAudio } from "../../../../../_lib/songs";

// /api/song-library/songs/[songId]/versions/[versionId]/audio. Handlers and the full route list: app/api/song-library/_lib/songs.ts.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ songId: string; versionId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { songId, versionId } = await params;
  return versionAudio(songId, versionId);
}
