import { confirmSplit, withdrawSplit } from "../../../../../_lib/credits";

// /api/song-library/songs/[songId]/writers/[writerId]/confirm. Handlers and the full route list: app/api/song-library/_lib/credits.ts.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ songId: string; writerId: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { songId, writerId } = await params;
  return confirmSplit(songId, writerId);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { songId, writerId } = await params;
  return withdrawSplit(songId, writerId);
}
