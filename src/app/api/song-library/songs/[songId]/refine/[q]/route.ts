import { putRefine } from "../../../../_lib/progress";

// /api/song-library/songs/[songId]/refine/[q]. Handlers and the full route list: app/api/song-library/_lib/progress.ts.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ songId: string; q: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { songId, q } = await params;
  return putRefine(request, songId, q);
}
