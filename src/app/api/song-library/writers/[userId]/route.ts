import { getWriter } from "../../_lib/help";

// /api/song-library/writers/[userId]. Handlers and the full route list: app/api/song-library/_lib/help.ts.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ userId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { userId } = await params;
  return getWriter(userId);
}
