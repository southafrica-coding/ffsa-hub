import { versionAudioRedirect } from "../../../_lib/songs";

// /api/song-library/versions/[versionId]/audio. Handlers and the full route list: app/api/song-library/_lib/songs.ts.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ versionId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { versionId } = await params;
  return versionAudioRedirect(versionId);
}
