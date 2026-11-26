import { deleteSong, getSong, patchSong } from "../../_lib/songs";

// /api/song-library/songs/[songId]. Handlers and the full route list: app/api/song-library/_lib/songs.ts.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ songId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { songId } = await params;
  return getSong(songId);
}

export async function PATCH(request: Request, { params }: Params) {
  const { songId } = await params;
  return patchSong(request, songId);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { songId } = await params;
  return deleteSong(songId);
}
