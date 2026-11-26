import { deleteCelebrate, putCelebrate } from "../../../../_lib/credits";

// /api/song-library/songs/[songId]/celebrate/[promptNo]. Handlers and the full route list: app/api/song-library/_lib/credits.ts.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ songId: string; promptNo: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { songId, promptNo } = await params;
  return putCelebrate(request, songId, promptNo);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { songId, promptNo } = await params;
  return deleteCelebrate(songId, promptNo);
}
