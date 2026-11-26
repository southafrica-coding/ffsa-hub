import { deleteCheckpoint, putCheckpoint } from "../../../../_lib/progress";

// /api/song-library/songs/[songId]/checkpoints/[kind]. Handlers and the full route list: app/api/song-library/_lib/progress.ts.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ songId: string; kind: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { songId, kind } = await params;
  return putCheckpoint(request, songId, kind);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { songId, kind } = await params;
  return deleteCheckpoint(songId, kind);
}
