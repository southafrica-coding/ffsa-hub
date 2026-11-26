import { createVersion } from "../../../_lib/songs";

// /api/song-library/songs/[songId]/versions. Handlers and the full route list: app/api/song-library/_lib/songs.ts.

export const dynamic = "force-dynamic";
// Recording a version also DMs subscribers (lib/slack/song-library-notify).
export const maxDuration = 60;

type Params = { params: Promise<{ songId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { songId } = await params;
  return createVersion(request, songId);
}
