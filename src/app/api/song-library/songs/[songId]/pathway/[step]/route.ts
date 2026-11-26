import { deletePathwayStep, putPathwayStep } from "../../../../_lib/progress";

// /api/song-library/songs/[songId]/pathway/[step]. Handlers and the full route list: app/api/song-library/_lib/progress.ts.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ songId: string; step: string }> };

export async function PUT(_request: Request, { params }: Params) {
  const { songId, step } = await params;
  return putPathwayStep(songId, step);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { songId, step } = await params;
  return deletePathwayStep(songId, step);
}
