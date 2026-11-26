import { deleteShareStep, putShareStep } from "../../../../_lib/progress";

// /api/song-library/songs/[songId]/share/[kind]. Handlers and the full route list: app/api/song-library/_lib/progress.ts.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ songId: string; kind: string }> };

export async function PUT(_request: Request, { params }: Params) {
  const { songId, kind } = await params;
  return putShareStep(songId, kind);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { songId, kind } = await params;
  return deleteShareStep(songId, kind);
}
