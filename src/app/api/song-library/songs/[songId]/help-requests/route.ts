import { createHelpRequest } from "../../../_lib/help";

// /api/song-library/songs/[songId]/help-requests. Handlers and the full route list: app/api/song-library/_lib/help.ts.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ songId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { songId } = await params;
  return createHelpRequest(request, songId);
}
