import { moveStage } from "../../../_lib/songs";

// /api/song-library/songs/[songId]/stage. Handlers and the full route list: app/api/song-library/_lib/songs.ts.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ songId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { songId } = await params;
  return moveStage(request, songId);
}
