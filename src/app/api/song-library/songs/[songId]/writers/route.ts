import { addWriter } from "../../../_lib/credits";

// /api/song-library/songs/[songId]/writers. Handlers and the full route list: app/api/song-library/_lib/credits.ts.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ songId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { songId } = await params;
  return addWriter(request, songId);
}
