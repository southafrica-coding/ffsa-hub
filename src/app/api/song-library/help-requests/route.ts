import { listHelpRequests } from "../_lib/help";

// /api/song-library/help-requests. Handlers and the full route list: app/api/song-library/_lib/help.ts.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return listHelpRequests(request);
}
