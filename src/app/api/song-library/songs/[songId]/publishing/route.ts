import { putPublishing } from "../../../_lib/credits";

// /api/song-library/songs/[songId]/publishing. Handlers and the full route list: app/api/song-library/_lib/credits.ts.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ songId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { songId } = await params;
  return putPublishing(request, songId);
}
